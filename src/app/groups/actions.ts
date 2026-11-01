"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CURRENCIES, parseAmountToMinorUnits } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type InviteState = { link?: string; inviteId?: string; error?: string };
export type PeopleSearchState = {
  query?: string;
  people?: {
    id: string;
    display_name: string;
    email: string | null;
    is_member: boolean;
  }[];
  error?: string;
};
export type EmailInviteState = { email?: string; success?: string; error?: string };

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
  const { supabase } = await getSignedInClient();
  const name = String(formData.get("name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "INR");

  if (
    name.length < 1 ||
    name.length > 80 ||
    !CURRENCIES.some((supportedCurrency) => supportedCurrency === currency)
  ) {
    goWithError("group-details");
  }

  const { data: groupId, error } = await supabase.rpc("create_group", {
    p_name: name,
    p_currency: currency,
  });
  if (error || !groupId) {
    console.error(
      "Group creation failed:",
      JSON.stringify({
        code: error?.code,
        message: error?.message ?? "The create_group RPC returned no group ID.",
        details: error?.details,
        hint: error?.hint,
      }),
    );
    if (error && ["42501", "PGRST202"].includes(error.code)) {
      goWithError("group-create-rpc-setup");
    }
    goWithError("group-create");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&step=first-expense&notice=group-created`);
}

export async function archiveGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  if (!uuidPattern.test(groupId)) goWithError("group-archive");

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("archive_group", {
    p_group_id: groupId,
  });
  if (error) {
    console.error("Group archive failed:", error.message);
    if (["PGRST202", "42883"].includes(error.code)) {
      goWithError("group-archive-setup");
    }
    if (error.message.includes("balances are settled")) {
      goWithError("group-not-settled");
    }
    goWithError("group-archive");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=group-archived`);
}

export async function setGroupPublic(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const isPublic = String(formData.get("isPublic") ?? "");
  if (!uuidPattern.test(groupId) || !["true", "false"].includes(isPublic)) {
    goWithError("group-visibility");
  }

  const { supabase } = await getSignedInClient();
  const { error } = await supabase.rpc("set_group_public", {
    p_group_id: groupId,
    p_is_public: isPublic === "true",
  });
  if (error) {
    console.error("Group visibility update failed:", error.message);
    if (["PGRST202", "42883"].includes(error.code)) {
      goWithError("group-visibility-setup");
    }
    goWithError("group-visibility");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=${isPublic === "true" ? "group-opened" : "group-closed"}`);
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

export async function searchInvitePeople(
  _previousState: PeopleSearchState,
  formData: FormData,
): Promise<PeopleSearchState> {
  const groupId = String(formData.get("groupId") ?? "");
  const query = String(formData.get("query") ?? "").trim();
  if (!uuidPattern.test(groupId)) return { query, error: "Select a valid group." };
  if (query.length < 2 || query.length > 254) {
    return { query, error: "Enter at least 2 characters to search." };
  }

  const { supabase } = await getSignedInClient();
  const { data, error } = await supabase.rpc("search_group_invite_candidates", {
    p_group_id: groupId,
    p_query: query,
  });
  if (error) {
    console.error("Invite people search failed:", error.message);
    if (error.message.includes("Search rate limit exceeded")) {
      return { query, error: "Too many searches in a short time. Wait a few minutes and try again." };
    }
    if (["PGRST202", "42883"].includes(error.code)) {
      return { query, error: "Apply the group-invites migration to enable people search." };
    }
    return { query, error: "People could not be searched. Only the group creator can invite." };
  }

  return { query, people: data };
}

export async function inviteExistingPerson(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!uuidPattern.test(groupId) || !uuidPattern.test(userId)) goWithError("invite-person");

  const { supabase } = await getSignedInClient();
  const { data, error } = await supabase.rpc("invite_group_member", {
    p_group_id: groupId,
    p_user_id: userId,
  });
  if (error || !data) {
    console.error("Existing SETTLR user invitation failed:", error?.message);
    if (error?.message.includes("group is full")) goWithError("invite-group-full");
    if (error && ["PGRST202", "42883"].includes(error.code)) {
      goWithError("invite-people-setup");
    }
    goWithError("invite-person");
  }

  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=person-added`);
}

export async function inviteExistingPeople(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const userIds = formData.getAll("userId").map(String);
  if (!uuidPattern.test(groupId)) goWithError("invite-person");
  const { supabase } = await getSignedInClient();
  for (const userId of userIds) {
    if (!uuidPattern.test(userId)) continue;
    const { error } = await supabase.rpc("invite_group_member", {
      p_group_id: groupId,
      p_user_id: userId,
    });
    if (error) console.error("Existing SETTLR user invitation failed:", error.message);
  }
  revalidatePath("/");
  redirect(`/?group=${groupId}&notice=person-added`);
}
export async function sendEmailInvite(
  _previousState: EmailInviteState,
  formData: FormData,
): Promise<EmailInviteState> {
  const groupId = String(formData.get("groupId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!uuidPattern.test(groupId)) return { email, error: "Select a valid group." };
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { email, error: "Enter a valid email address." };
  }

  const { supabase, user } = await getSignedInClient();
  if (user.email?.toLowerCase() === email) {
    return { email, error: "You’re already a member of this group." };
  }
  const { data: matches, error: searchError } = await supabase.rpc(
    "search_group_invite_candidates",
    { p_group_id: groupId, p_query: email },
  );
  if (searchError) {
    console.error("Email invitation account lookup failed:", searchError.message);
    if (["PGRST202", "42883"].includes(searchError.code)) {
      return { email, error: "Apply the group-invites migration to enable email invitations." };
    }
    return { email, error: "The address could not be checked for a SETTLR account." };
  }

  const existingPerson = matches.find(
    (person) => person.email?.toLowerCase() === email,
  );
  if (existingPerson) {
    if (existingPerson.is_member) {
      return { email, error: "That person is already in this group." };
    }
    const { error } = await supabase.rpc("invite_group_member", {
      p_group_id: groupId,
      p_user_id: existingPerson.id,
    });
    if (error) {
      console.error("Existing account invitation by email failed:", error.message);
      if (error.message.includes("group is full")) {
        return { email, error: "This group has reached its 40-person limit." };
      }
      return { email, error: "The SETTLR account could not be added to this group." };
    }
    revalidatePath("/");
    return { email, success: "That SETTLR user has been added to the group." };
  }

  const baseUrl = getSiteUrl();
  if (!baseUrl) return { email, error: "Set NEXT_PUBLIC_SITE_URL to send invitations." };
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      email,
      error: "Email invitations require the server-side Supabase service role key.",
    };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: inviteId, error: inviteError } = await supabase.rpc(
    "create_group_invite",
    { p_group_id: groupId, p_token_hash: tokenHash, p_expires_at: expiresAt },
  );
  if (inviteError || !inviteId) {
    console.error("Email group invite creation failed:", inviteError?.message);
    return { email, error: "The group invitation could not be created." };
  }

  const nextPath = `/?invite=${token}`;
  const admin = createAdminClient();
  const { error: emailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
  });
  if (emailError) {
    console.error("Supabase Auth email invitation failed:", emailError.code);
    const { error: revokeError } = await supabase.rpc("revoke_group_invite", {
      p_invite_id: inviteId,
    });
    if (revokeError) {
      console.error("Failed to revoke unused email invitation:", revokeError.message);
    }
    return {
      email,
      error:
        "The invitation email could not be sent. Check Supabase email delivery and the allowed redirect URLs.",
    };
  }

  revalidatePath("/");
  return {
    email,
    success: "Invitation email sent. They can set a password and join from the email link.",
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

export async function joinOpenGroup(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  if (!uuidPattern.test(groupId)) goWithError("group-join-invalid");

  const { supabase } = await getSignedInClient();
  const { data: joinedGroupId, error } = await supabase.rpc("join_open_group", {
    p_group_id: groupId,
  });
  if (error || !joinedGroupId) {
    if (error) console.error("Open group join failed:", error.message);
    if (error && ["PGRST202", "42883"].includes(error.code)) {
      goWithError("group-join-setup");
    }
    goWithError("group-join-failed");
  }

  revalidatePath("/");
  redirect(`/?group=${joinedGroupId}&notice=joined-group`);
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
  if (
    !uuidPattern.test(groupId) ||
    !uuidPattern.test(fromUserId) ||
    !uuidPattern.test(toUserId)
  ) {
    goWithError("settlement-details");
  }

  const { supabase } = await getSignedInClient();
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("currency")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError || !group) {
    if (groupError) console.error("Settlement currency lookup failed:", groupError.message);
    goWithError("settlement-details");
  }
  const amountMinor = parseAmountToMinorUnits(
    String(formData.get("amount") ?? ""),
    group.currency,
  );
  if (amountMinor === null) goWithError("settlement-details");

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
