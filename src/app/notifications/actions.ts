"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function markSettlementNotificationRead(formData: FormData) {
  const notificationId = String(formData.get("notificationId") ?? "");
  if (!uuidPattern.test(notificationId)) {
    redirect("/notifications?error=notification-details");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fnotifications");

  const { error } = await supabase
    .from("settlement_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .is("read_at", null);
  if (error) {
    console.error("Settlement notification update failed:", error.message);
    redirect("/notifications?error=notification-update");
  }

  revalidatePath("/notifications");
}
