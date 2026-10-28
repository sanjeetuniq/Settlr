"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CURRENCIES, parseAmountToMinorUnits } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type InviteState = { link?: string; inviteId?: string; error?: string };

function goWithError(code: string): never {
  redirect(`/?error=${encodeURIComponent(code)}`);
}

async function getSignedInClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) goWithError("sign-in");
  return { supabase, user: data.user };
}

export async function createGroup(formData: FormData) {
  const { supabase, user } = await getSignedInClient();
  const name = String(formData.get("name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "INR");

  if (
    name.length < 1 ||
    name.length > 80 ||
    !CURRENCIES.some((supportedCurrency) => supportedCurrency === currency)
  ) {
    goWithError("group-details");
  }

  const { data, error } = await supabase
    .from("groups")
    .insert({ name, currency, created_by: user.id })
    .select("id")
    .single();
  if (error) {
    console.error("Group creation failed:", error.message);
    goWithError("group-create");
  }

  revalidatePath("/");
  redirect(`/?group=${data.id}&notice=group-created`);
}

export async function createInvite(
  _previousState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const groupId = String(formData.get("groupId") ?? "");
  if (!uuidPattern.test(groupId)) return { error: "Select a valid group." };

  const baseUrl = getSiteUrl();
  if (!baseUrl) return { error: "Set NEXT_PUBLIC_SITE_URL to create an invite link." };

  const { supabase } = await getSignedInClient();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: inviteId, error } = await supabase.rpc("create_group_invite", {
    p_group_id: groupId,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error || !inviteId) {
    if (error) console.error("Invite creation failed:", error.message);
    return { error: "Invite could not be created. Only the group creator can make links." };
  }

  revalidatePath("/");
  return {
    link: `${baseUrl}/?invite=${token}`,
    inviteId,
  };
}

export async function revokeInvite(formData: FormData) {
  const inviteId = String(formData.get("inviteId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  if (!uuidPattern.test(inviteId) || !uuidPattern.test(groupId)) {
    goWithError("invite-revoke");
  }

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("revoke_group_invite", {
    p_invite_id: inviteId,
  });
  if (error) {
    console.error("Invite revocation failed:", error.message);
    goWithError("invite-revoke");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=invite-revoked`);
}

export async function joinGroup(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) goWithError("invite-invalid");

  const { supabase } = await getSignedInClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: groupId, error } = await supabase.rpc("join_group_with_invite", {
    p_token_hash: tokenHash,
  });
  if (error || !groupId) {
    if (error) console.error("Invite join failed:", error.message);
    goWithError("invite-invalid");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=joined-group`);
}

export async function createExpense(
  payload: {
    groupId: string;
    description: string;
    category: string;
    amount: string;
    payerId: string;
    spentAt: string;
    shares: { user_id: string; amount_minor: number }[];
  },
) {
  const { supabase } = await getSignedInClient();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.amount !== "string" ||
    typeof payload.groupId !== "string" ||
    typeof payload.description !== "string" ||
    typeof payload.category !== "string" ||
    typeof payload.payerId !== "string" ||
    typeof payload.spentAt !== "string" ||
    !Array.isArray(payload.shares)
  ) {
    return { error: "Check the expense details and try again." };
  }

  const validShares = payload.shares.every(
    (share) =>
      share !== null &&
      typeof share === "object" &&
      typeof share.user_id === "string" &&
      Number.isSafeInteger(share.amount_minor),
  );
  if (!validShares) return { error: "The expense split is invalid." };

  const amountMinor = parseAmountToMinorUnits(payload.amount);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(payload.spentAt)
    ? new Date(`${payload.spentAt}T00:00:00.000Z`)
    : null;
  const uniqueIds = new Set(payload.shares.map((share) => share.user_id));
  const shareTotal = payload.shares.reduce(
    (total, share) => total + share.amount_minor,
    0,
  );
  const groupIdValid = uuidPattern.test(payload.groupId);
  const participantIdsValid =
    payload.shares.length > 0 &&
    payload.shares.length <= 40 &&
    uniqueIds.size === payload.shares.length &&
    payload.shares.every(
      (share) =>
        uuidPattern.test(share.user_id) &&
        Number.isSafeInteger(share.amount_minor) &&
        share.amount_minor >= 0,
    );

  if (
    !groupIdValid ||
    !payload.description.trim() ||
    payload.description.trim().length > 120 ||
    !["Food", "Transport", "Stay", "Utilities", "Other"].includes(payload.category) ||
    amountMinor === null ||
    !uuidPattern.test(payload.payerId) ||
    !parsedDate ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== payload.spentAt ||
    !participantIdsValid ||
    payload.shares.every((share) => share.amount_minor === 0) ||
    shareTotal !== amountMinor
  ) {
    return { error: "Check the expense details and make sure shares add up exactly." };
  }

  const { data: expenseId, error } = await supabase.rpc("create_expense", {
    p_group_id: payload.groupId,
    p_description: payload.description.trim(),
    p_category: payload.category,
    p_amount_minor: amountMinor,
    p_payer_id: payload.payerId,
    p_spent_at: payload.spentAt,
    p_shares: payload.shares,
  });
  if (error || !expenseId) {
    if (error) console.error("Expense creation failed:", error.message);
    return { error: "Expense could not be saved. Check that everyone is still in the group." };
  }

  revalidatePath("/");
  return { expenseId };
}

export async function recordSettlement(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const fromUserId = String(formData.get("fromUserId") ?? "");
  const toUserId = String(formData.get("toUserId") ?? "");
  const amountMinor = parseAmountToMinorUnits(String(formData.get("amount") ?? ""));
  if (
    !uuidPattern.test(groupId) ||
    !uuidPattern.test(fromUserId) ||
    !uuidPattern.test(toUserId) ||
    amountMinor === null
  ) {
    goWithError("settlement-details");
  }

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("create_settlement", {
    p_group_id: groupId,
    p_from_user_id: fromUserId,
    p_to_user_id: toUserId,
    p_amount_minor: amountMinor,
  });
  if (error) {
    console.error("Settlement recording failed:", error.message);
    goWithError("settlement-save");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=settlement-recorded`);
}

export async function sendReminder(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const recipientId = String(formData.get("recipientId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  if (
    !uuidPattern.test(groupId) ||
    !uuidPattern.test(recipientId) ||
    message.length < 1 ||
    message.length > 280
  ) {
    goWithError("reminder-details");
  }

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("send_in_app_reminder", {
    p_group_id: groupId,
    p_recipient_id: recipientId,
    p_message: message,
  });
  if (error) {
    console.error("In-app reminder failed:", error.message);
    goWithError("reminder-send");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=reminder-sent`);
}

export async function markReminderRead(formData: FormData) {
  const reminderId = String(formData.get("reminderId") ?? "");
  if (!uuidPattern.test(reminderId)) goWithError("reminder-details");

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("mark_reminder_read", {
    p_reminder_id: reminderId,
  });
  if (error) {
    console.error("Reminder update failed:", error.message);
    goWithError("reminder-update");
  }

  revalidatePath("/");
}
