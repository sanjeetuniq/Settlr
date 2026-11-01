import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isWhatsAppProviderConfigured,
  sendWhatsAppTemplate,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workerSecret = process.env.WHATSAPP_WORKER_SECRET;
  if (
    !workerSecret ||
    workerSecret.length < 32 ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return Response.json({ error: "WhatsApp worker is not configured." }, { status: 503 });
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(workerSecret);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const activityTemplate = process.env.WHATSAPP_ACTIVITY_TEMPLATE_NAME;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!activityTemplate || !siteUrl || !isWhatsAppProviderConfigured()) {
    return Response.json({ error: "WhatsApp provider is not configured." }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: batch, error: claimError } = await admin.rpc(
    "claim_whatsapp_notification_batch",
    { p_limit: 10 },
  );
  if (claimError) {
    console.error("WhatsApp notification batch could not be claimed:", claimError.message);
    return Response.json({ error: "Notification queue is unavailable." }, { status: 503 });
  }

  let sent = 0;
  let deferred = 0;
  for (const notification of batch) {
    const result = await sendWhatsAppTemplate(
      notification.phone_e164,
      activityTemplate,
      [siteUrl],
    );
    const completedAt = new Date();
    const update = result.ok
      ? {
          sent_at: completedAt.toISOString(),
          locked_until: null,
          provider_message_id: result.messageId ?? null,
          last_error: null,
        }
      : {
          locked_until: null,
          available_at: new Date(
            completedAt.getTime() +
              Math.min(60, 2 ** Math.max(0, notification.attempts - 1)) * 60_000,
          ).toISOString(),
          discarded_at: notification.attempts >= 8 ? completedAt.toISOString() : null,
          last_error: `provider_${result.reason}`,
        };
    const { error: updateError } = await admin
      .from("whatsapp_notification_outbox")
      .update(update)
      .eq("id", notification.id)
      .is("sent_at", null);
    if (updateError) {
      console.error("WhatsApp notification acknowledgement failed:", updateError.message);
      deferred++;
      continue;
    }
    if (result.ok) sent++;
    else deferred++;
  }

  return Response.json({ claimed: batch.length, sent, deferred });
}
