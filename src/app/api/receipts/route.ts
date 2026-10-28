import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateReceipt } from "@/lib/receipt-validation";

const maxRequestBytes = 5 * 1024 * 1024 + 64 * 1024;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin) {
    return errorResponse("Cross-origin uploads are not allowed.", 403);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse("Sign in to upload a receipt.", 401);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("Use a multipart form to upload a receipt.", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return errorResponse("The upload request is larger than 5 MB.", 413);
  }

  let formData: FormData;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("The upload request has no file body.", 400);

    const chunks: ArrayBuffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel();
        return errorResponse("The upload request is larger than 5 MB.", 413);
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
    return errorResponse("The upload request could not be read.", 400);
  }

  const file = formData.get("file");
  const expenseId = String(formData.get("expenseId") ?? "");
  if (
    !(file instanceof File) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      expenseId,
    )
  ) {
    return errorResponse("Choose a valid receipt and expense.", 400);
  }
  if (file.size < 1 || file.size > 5 * 1024 * 1024) {
    return errorResponse("Receipts must be between 1 byte and 5 MB.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateReceipt(bytes, file.type);
  if (!validation.valid) {
    return errorResponse(validation.message, 415);
  }
  const detectedType = validation.contentType;

  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, group_id")
    .eq("id", expenseId)
    .maybeSingle();
  if (expenseError) {
    console.error("Receipt expense lookup failed:", expenseError.message);
    return errorResponse("The expense could not be verified.", 500);
  }
  if (!expense) return errorResponse("Expense not found or access denied.", 404);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(
      "Receipt storage is not configured. Add the server-only storage key.",
      503,
    );
  }

  const extension = detectedType === "image/png" ? "png" : "pdf";
  const storagePath = `${expense.group_id}/${crypto.randomUUID()}.${extension}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("expense-receipts")
    .upload(storagePath, bytes, {
      contentType: detectedType,
      upsert: false,
    });
  if (uploadError) {
    console.error("Receipt storage upload failed:", uploadError.message);
    return errorResponse("Receipt upload failed. Try again.", 500);
  }

  const safeName = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 180);
  const { error: registrationError } = await supabase.rpc(
    "register_expense_attachment",
    {
      p_expense_id: expense.id,
      p_storage_path: storagePath,
      p_file_name: safeName || `receipt.${extension}`,
      p_content_type: detectedType,
      p_size_bytes: file.size,
    },
  );
  if (registrationError) {
    const { error: cleanupError } = await admin.storage
      .from("expense-receipts")
      .remove([storagePath]);
    if (cleanupError) {
      console.error("Receipt cleanup failed:", cleanupError.message);
    }
    console.error("Receipt metadata registration failed:", registrationError.message);
    return errorResponse("Receipt could not be attached to the expense.", 500);
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
