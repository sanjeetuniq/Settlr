"use server";

import { createHmac, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isWhatsAppProviderConfigured,
  sendWhatsAppTemplate,
} from "@/lib/whatsapp";

export type WhatsAppActionState = {
  phone?: string;
  success?: string;
  error?: string;
};

const phonePattern = /^\+[1-9][0-9]{7,14}$/;
const codePattern = /^\d{6}$/;

function codeDigest(code: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createHmac("sha256", secret).update(code).digest("hex");
}

async function signedInUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function requestWhatsAppCode(
  _previous: WhatsAppActionState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  const user = await signedInUser();
  if (!user) return { error: "Sign in again to continue." };

  const phone = String(formData.get("phone") ?? "").trim();
  if (!phonePattern.test(phone)) {
    return { phone, error: "Enter the full number in international format, such as +14155550123." };
  }

  const otpTemplate = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  if (
    !isWhatsAppProviderConfigured() ||
    !otpTemplate ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      phone,
      error: "WhatsApp verification is not configured yet. Contact helpdesk_settlr@gmail.com for help.",
    };
  }

  const code = String(randomInt(100_000, 1_000_000));
  const admin = createAdminClient();
  const { error: reserveError } = await admin.rpc("request_whatsapp_verification", {
    p_user_id: user.id,
    p_phone_e164: phone,
    p_code_hash: codeDigest(code),
  });
  if (reserveError) {
    console.error("WhatsApp verification request could not be reserved:", reserveError.message);
    return {
      phone,
      error: reserveError.message.includes("Wait before")
        ? "Wait one minute before requesting another code."
        : reserveError.message.includes("request limit")
          ? "You have reached the hourly code limit. Try again later."
          : "Verification could not be started. Apply the WhatsApp migration and try again.",
    };
  }

  const result = await sendWhatsAppTemplate(phone, otpTemplate, [code], true);
  if (!result.ok) {
    const { error: cleanupError } = await admin
      .from("whatsapp_verification_codes")
      .delete()
      .eq("user_id", user.id);
    if (cleanupError) {
      console.error("Failed to remove an unsent WhatsApp verification code:", cleanupError.message);
    }
    return {
      phone,
      error: "The verification message could not be sent. Check the approved Meta template and provider settings.",
    };
  }

  return { phone, success: "A verification code was sent to your WhatsApp number." };
}

export async function verifyWhatsAppCode(
  _previous: WhatsAppActionState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  const user = await signedInUser();
  if (!user) return { error: "Sign in again to continue." };

  const code = String(formData.get("code") ?? "").trim();
  if (!codePattern.test(code)) return { error: "Enter the six-digit verification code." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "WhatsApp verification is not configured yet." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("verify_whatsapp_code", {
    p_user_id: user.id,
    p_code_hash: codeDigest(code),
  });
  if (error) {
    console.error("WhatsApp phone verification failed:", error.message);
    return {
      error: ["PGRST202", "42883"].includes(error.code)
        ? "Apply the WhatsApp migration, then request a new code."
        : "The verification code could not be checked. Request a new code and try again.",
    };
  }
  if (!data) return { error: "The code is incorrect or expired. Request a new code to try again." };

  revalidatePath("/");
  return { success: "Your WhatsApp number is verified. Choose your alerts and opt in below." };
}

export async function saveWhatsAppPreferences(
  _previous: WhatsAppActionState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  const user = await signedInUser();
  if (!user) return { error: "Sign in again to continue." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "WhatsApp preferences are not configured yet." };
  }

  const admin = createAdminClient();
  const { data: preference, error: readError } = await admin
    .from("whatsapp_preferences")
    .select("phone_e164, phone_verified_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) {
    console.error("WhatsApp preference lookup failed:", readError.message);
    return {
      error: ["PGRST205", "42P01"].includes(readError.code)
        ? "Apply the WhatsApp migration to configure alerts."
        : "Your verified WhatsApp number could not be loaded.",
    };
  }
  if (!preference?.phone_e164 || !preference.phone_verified_at) {
    return { error: "Verify your WhatsApp number before changing notification preferences." };
  }

  const optedIn = formData.get("optIn") === "on";
  if (optedIn && formData.get("consent") !== "on") {
    return { error: "Confirm the WhatsApp opt-in consent before enabling alerts." };
  }
  if (
    optedIn &&
    (!isWhatsAppProviderConfigured() || !process.env.WHATSAPP_ACTIVITY_TEMPLATE_NAME)
  ) {
    return { error: "Configure an approved activity template before enabling WhatsApp alerts." };
  }

  const { error } = await admin
    .from("whatsapp_preferences")
    .update({
      opted_in_at: optedIn ? new Date().toISOString() : null,
      expense_alerts: formData.get("expenseAlerts") === "on",
      invitation_alerts: formData.get("invitationAlerts") === "on",
      reminder_alerts: formData.get("reminderAlerts") === "on",
      settlement_alerts: formData.get("settlementAlerts") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) {
    console.error("WhatsApp preferences could not be saved:", error.message);
    return { error: "WhatsApp preferences could not be saved. Try again." };
  }

  revalidatePath("/");
  return {
    success: optedIn
      ? "WhatsApp alerts are enabled for your selected activity."
      : "WhatsApp alerts are turned off.",
  };
}
