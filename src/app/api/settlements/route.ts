import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { parseAmountToMinorUnits } from "@/lib/money";
import { isValidSettlementComment } from "@/lib/settlement-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_RECEIPT_BYTES, validateReceipt } from "@/lib/receipt-validation";

const maxRequestBytes = MAX_RECEIPT_BYTES + 64 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return errorResponse("Cross-origin settlement requests are not allowed.", 403);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse("Sign in to record a settlement.", 401);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("Submit the settlement as a form.", 400);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return errorResponse("The attachment must be 5 MB or smaller.", 413);
  }

  let formData: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("The settlement request has no form body.", 400);

    const chunks: ArrayBuffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel();
        return errorResponse("The attachment must be 5 MB or smaller.", 413);
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }

    const parsedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Blob(chunks),
    });
    formData = await parsedRequest.formData();
  } catch {
    return errorResponse("The settlement form could not be read.", 400);
  }

  const groupId = String(formData.get("groupId") ?? "");
  const fromUserId = String(formData.get("fromUserId") ?? "");
  const toUserId = String(formData.get("toUserId") ?? "");
  const rawComment = String(formData.get("comment") ?? "");
  const comment = rawComment.trim();
  if (
    !uuidPattern.test(groupId) ||
    !uuidPattern.test(fromUserId) ||
    !uuidPattern.test(toUserId) ||
    !isValidSettlementComment(comment)
  ) {
    return errorResponse("Check the settlement details and keep the note within 50 characters.", 400);
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("currency")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError) {
    console.error("Settlement group lookup failed:", groupError.message);
    return errorResponse("The group could not be verified.", 500);
  }
  if (!group) return errorResponse("Group not found or access denied.", 404);

  const amountMinor = parseAmountToMinorUnits(
    String(formData.get("amount") ?? ""),
    group.currency,
  );
  if (amountMinor === null) {
    return errorResponse("Enter a valid settlement amount.", 400);
  }

  const submittedFile = formData.get("file");
  const file =
    submittedFile instanceof File && submittedFile.size > 0
      ? submittedFile
      : null;
  let attachmentPath: string | null = null;
  let attachmentName: string | null = null;
  let attachmentType: "image/png" | "application/pdf" | null = null;
  let attachmentBytes: Uint8Array | null = null;
  let attachmentSize: number | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;

  if (file) {
    if (file.size > MAX_RECEIPT_BYTES) {
      return errorResponse("Attachments must be 5 MB or smaller.", 413);
    }
    if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse(
        "Settlement attachments are not configured. Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY on the server.",
        503,
      );
    }

    attachmentBytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateReceipt(attachmentBytes, file.type);
    if (!validation.valid) return errorResponse(validation.message, 415);

    attachmentType = validation.contentType;
    attachmentSize = file.size;
    const extension = attachmentType === "image/png" ? "png" : "pdf";
    attachmentPath = `${groupId}/settlements/${randomUUID()}.${extension}`;
    attachmentName =
      file.name.replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 180) ||
      `settlement.${extension}`;
    admin = createAdminClient();

    const { error: uploadError } = await admin.storage
      .from("expense-receipts")
      .upload(attachmentPath, attachmentBytes, {
        contentType: attachmentType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Settlement attachment upload failed:", uploadError.message);
      return errorResponse("The attachment could not be uploaded. Try again.", 500);
    }
  }

  const { data: settlementId, error: settlementError } = await supabase.rpc(
    "create_settlement_with_details",
    {
      p_group_id: groupId,
      p_from_user_id: fromUserId,
      p_to_user_id: toUserId,
      p_amount_minor: amountMinor,
      p_comment: comment || null,
      p_attachment_path: attachmentPath,
      p_file_name: attachmentName,
      p_content_type: attachmentType,
      p_size_bytes: attachmentSize,
    },
  );
  if (settlementError || !settlementId) {
    if (attachmentPath && admin) {
      const { error: cleanupError } = await admin.storage
        .from("expense-receipts")
        .remove([attachmentPath]);
      if (cleanupError) {
        console.error("Failed to clean up an unused settlement attachment:", cleanupError.message);
      }
    }
    if (settlementError) {
      console.error("Settlement recording failed:", settlementError.message);
      if (["PGRST202", "42883"].includes(settlementError.code)) {
        return errorResponse(
          "Apply the settlement comments and attachments migration in Supabase, then try again.",
          503,
        );
      }
      if (
        settlementError.message.includes("Settlement exceeds") ||
        settlementError.message.includes("Settlement parties do not match")
      ) {
        return errorResponse("That amount is no longer owed. Refresh the balances and try again.", 409);
      }
    }
    return errorResponse("The settlement could not be recorded. Refresh the balances and try again.", 400);
  }

  let fullySettled = false;
  const { data: balances, error: balancesError } = await supabase.rpc(
    "group_balances",
    { p_group_id: groupId },
  );
  if (balancesError) {
    console.error("Post-settlement balance lookup failed:", balancesError.message);
  } else {
    fullySettled = balances.every((balance) => balance.balance_minor === 0);
  }

  revalidatePath("/");
  revalidatePath("/balances");
  revalidatePath("/notifications");
  revalidatePath("/transactions");
  return NextResponse.json(
    { success: true, settlementId, fullySettled },
    { status: 201 },
  );
}
