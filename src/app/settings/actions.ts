"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateProfileName(formData: FormData) {
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName.length < 1 || displayName.length > 80) {
    redirect("/settings?error=profile-name");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    if (authError) console.error("Profile update authentication failed:", authError.message);
    redirect("/sign-in?next=%2Fsettings");
  }

  const { error } = await supabase.from("profiles").upsert(
    { id: user.id, display_name: displayName },
    { onConflict: "id" },
  );
  if (error) {
    console.error("Profile name update failed:", error.message);
    redirect("/settings?error=profile-save");
  }

  revalidatePath("/");
  revalidatePath("/balances");
  revalidatePath("/settings");
  redirect("/settings?notice=profile-saved");
}