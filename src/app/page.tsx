import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BrandLogo } from "@/components/brand-logo";
import { ExpenseComposer } from "@/components/expense-composer";
import { InviteForm } from "@/components/invite-form";
import { SettlementCelebration } from "@/components/settlement-celebration";
import { SettlementForm } from "@/components/settlement-form";
import { PendingButton } from "@/components/pending-button";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  archiveGroup,
  createGroup,
  joinGroup,
  sendReminder,
  setGroupPublic,
} from "@/app/groups/actions";
import {
  formatMoney,
  simplifyBalances,
} from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

type SearchParams = Promise<{
  group?: string;
  invite?: string;
  notice?: string;
  celebration?: string;
  error?: string;
  step?: string;
}>;

const errorMessages: Record<string, string> = {
  "invite-revoke": "Invite link could not be revoked.",
  "invite-person": "That SETTLR user could not be added to the group.",
  "invite-people-setup": "Apply the group-invites migration in Supabase, then try again.",
  "invite-people-failed": "None of the selected people could be added. Refresh the group and try again.",
  "invite-group-full": "This group has reached its 40-person limit.",
  "group-details": "Give your group a name and choose a supported currency.",
  "group-create": "Your group could not be created. Please try again.",
  "group-create-rpc-setup":
    "Group creation needs the latest create_group database function. Apply its SQL from the project migration in Supabase, then try again.",
  "group-archive": "The group could not be archived.",
  "group-archive-setup": "Apply the group archive migration in Supabase, then try again.",
  "group-not-settled": "Settle every member balance before archiving this group.",
  "group-not-settled-setup": "Apply the group archive migration in Supabase, then try again.",
  "group-visibility": "Only the group creator can change group visibility.",
  "group-visibility-setup": "Apply the public-group migration in Supabase, then try again.",
  "group-join-invalid": "Choose a valid open group.",
  "group-join-failed": "This group may have closed or reached its 40-member limit.",
  "group-join-setup": "Apply the public-group migration in Supabase, then try again.",
  "invite-invalid": "That invite is invalid, expired, revoked, or the group is full.",
  "settlement-details": "Enter a valid settlement amount and group members.",
  "settlement-save": "Settlement could not be recorded. Check the current balance.",
  "reminder-details": "Choose a group member and write a short reminder.",
  "reminder-send": "The in-app reminder could not be sent.",
  "reminder-update": "The reminder could not be marked as read.",
  "sign-in": "Sign in again to continue.",
};

const noticeMessages: Record<string, string> = {
  "group-created": "Your new group is ready.",
  "group-first-expense": "Your first expense is saved. Invite the group and keep sharing.",
  "group-opened": "Your group is now discoverable and open to join.",
  "group-closed": "Your group is private again.",
  "group-archived": "Group archived. Its history remains available in your archive.",
  "joined-group": "You joined the group. Welcome in!",
  "settlement-recorded": "Settlement recorded and balances updated.",
  "reminder-sent": "In-app reminder sent.",
  "invite-revoked": "Invite link revoked.",
  "person-added": "Your person has been added to the group.",
  "people-added": "Selected people were added to the group.",
  "people-added-partial": "Some selected people were added, but one or more could not be added. Check the group capacity and try again.",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function MigrationSetupNotice() {
  return (
    <main className="error-shell">
      <section className="error-card" role="status">
        <span className="empty-illustration">✳</span>
        <div className="eyebrow">DATABASE SETUP NEEDED</div>
        <h1>Complete the database setup.</h1>
        <p>
          The core group tables are unavailable. Apply the initial schema from
          <code> supabase/migrations </code> to your Supabase project, then refresh.
        </p>
        <Link className="button button-primary" href="/">Try again</Link>
      </section>
    </main>
  );
}

function OptionalMigrationsNotice({
  discoveryAvailable,
  archiveAvailable,
}: {
  discoveryAvailable: boolean;
  archiveAvailable: boolean;
}) {
  const unavailableFeatures = [
    ...(discoveryAvailable ? [] : ["public-group discovery and visibility"]),
    ...(archiveAvailable ? [] : ["group archiving"]),
  ];

  return (
    <div className="notice-banner migration-notice" role="status">
      {`Optional features are not enabled yet: ${unavailableFeatures.join(" and ")}. Apply the corresponding Supabase migrations to enable them. Your existing groups and expenses remain available.`}
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const inviteToken =
    params.invite && /^[0-9a-f]{64}$/.test(params.invite) ? params.invite : undefined;

  const returnTo = inviteToken ? `/?invite=${inviteToken}` : "/";
  const signInPath = `/sign-in?next=${encodeURIComponent(returnTo)}`;
  if (!isSupabaseConfigured()) redirect(signInPath);

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Dashboard authentication lookup failed:", authError.message);
    redirect(signInPath);
  }
  if (!user) redirect(signInPath);

  const { data: membershipRows, error: membershipsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);
  if (membershipsError) {
    if (membershipsError.code === "PGRST205") return <MigrationSetupNotice />;
    console.error("Group membership lookup failed:", membershipsError.message);
    throw new Error("Your group memberships could not be loaded.");
  }
  const memberGroupIds = membershipRows.map((membership) => membership.group_id);
  let groups: {
    id: string;
    name: string;
    currency: string;
    is_public: boolean;
    archived_at: string | null;
    created_by: string;
    created_at: string;
  }[] = [];
  let visibilityMigrationAvailable = true;
  let archiveMigrationAvailable = true;
  if (memberGroupIds.length > 0) {
    const { data, error: groupsError } = await supabase
      .from("groups")
      .select("id, name, currency, created_by, created_at")
      .in("id", memberGroupIds)
      .order("created_at", { ascending: false });
    if (groupsError) {
      if (groupsError.code === "PGRST205") return <MigrationSetupNotice />;
      console.error("Group list query failed:", groupsError.message);
      throw new Error("Your groups could not be loaded. Please apply the latest database migration.");
    }
    const [visibilityResult, archiveResult] = await Promise.all([
      supabase
        .from("groups")
        .select("id, is_public")
        .in("id", memberGroupIds),
      supabase
        .from("groups")
        .select("id, archived_at")
        .in("id", memberGroupIds),
    ]);
    if (visibilityResult.error) {
      if (["PGRST204", "PGRST205", "42703"].includes(visibilityResult.error.code)) {
        visibilityMigrationAvailable = false;
        console.warn("Public-group migration is not available; discovery controls are disabled.");
      } else {
        console.error("Group visibility query failed:", visibilityResult.error.message);
        throw new Error("Group visibility could not be loaded.");
      }
    }
    if (archiveResult.error) {
      if (["PGRST204", "PGRST205", "42703"].includes(archiveResult.error.code)) {
        archiveMigrationAvailable = false;
        console.warn("Group archive migration is not available; archive controls are disabled.");
      } else {
        console.error("Group archive query failed:", archiveResult.error.message);
        throw new Error("Group archive status could not be loaded.");
      }
    }
    const visibilityById = new Map(
      (visibilityResult.data ?? []).map((group) => [group.id, group.is_public]),
    );
    const archiveById = new Map(
      (archiveResult.data ?? []).map((group) => [group.id, group.archived_at]),
    );
    groups = data.map((group) => ({
      ...group,
      is_public: visibilityById.get(group.id) ?? false,
      archived_at: archiveById.get(group.id) ?? null,
    }));
  }

  const { error: openGroupsError } = await supabase.rpc("list_open_groups");
  let openGroupDiscoveryAvailable = true;
  if (openGroupsError) {
    if (["PGRST202", "42883"].includes(openGroupsError.code)) {
      openGroupDiscoveryAvailable = false;
      console.warn("Public-group migration is not available; open-group discovery is disabled.");
    } else {
      console.error("Open group discovery query failed:", openGroupsError.message);
      throw new Error("Open groups could not be loaded.");
    }
  }
  const optionalMigrationsAvailable =
    visibilityMigrationAvailable &&
    archiveMigrationAvailable &&
    openGroupDiscoveryAvailable;

  const groupData = await Promise.all(
    groups.map(async (group) => {
      const [membersResult, expensesResult, balancesResult] = await Promise.all([
        supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", group.id)
          .order("joined_at", { ascending: true }),
        supabase
          .from("expenses")
          .select("id, description, category, amount_minor, payer_id, spent_at, created_at")
          .eq("group_id", group.id)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.rpc("group_balances", { p_group_id: group.id }),
      ]);
      if (membersResult.error || expensesResult.error || balancesResult.error) {
        const error =
          membersResult.error ?? expensesResult.error ?? balancesResult.error;
        console.error("Group dashboard query failed:", error?.message);
        throw new Error(`The ${group.name} group details could not be loaded.`);
      }

      let invites: { id: string; expires_at: string }[] = [];
      if (group.created_by === user.id) {
        const { data: inviteRows, error: inviteError } = await supabase
          .from("group_invites")
          .select("id, expires_at")
          .eq("group_id", group.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false });
        if (inviteError) {
          console.error("Invite list query failed:", inviteError.message);
          throw new Error(`Invites in ${group.name} could not be loaded.`);
        }
        invites = inviteRows;
      }

      return {
        ...group,
        members: membersResult.data,
        expenses: expensesResult.data,
        balances: balancesResult.data,
        suggestions: simplifyBalances(balancesResult.data),
        invites,
      };
    }),
  );

  let phoneSearchAvailable = false;
  if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { error: phoneSearchError } = await admin
      .from("whatsapp_preferences")
      .select("phone_discoverable")
      .eq("user_id", user.id)
      .maybeSingle();
    if (phoneSearchError && !["PGRST204", "PGRST205", "42703", "42P01"].includes(phoneSearchError.code)) {
      console.error("Phone-search availability lookup failed:", phoneSearchError.message);
    } else {
      phoneSearchAvailable = !phoneSearchError;
    }
  }

  const profileIds = Array.from(
    new Set([
      user.id,
      ...groupData.flatMap((group) => [
        ...group.members.map((member) => member.user_id),
        ...group.expenses.map((expense) => expense.payer_id),
      ]),
    ]),
  );
  const profileResult = await supabase
    .from("profiles")
    .select("id, display_name, avatar_path")
    .in("id", profileIds);
  let profiles: {
    id: string;
    display_name: string;
    avatar_path: string | null;
  }[];
  let avatarMigrationAvailable = true;
  if (profileResult.error && ["PGRST204", "42703"].includes(profileResult.error.code)) {
    avatarMigrationAvailable = false;
    const fallbackProfiles = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", profileIds);
    if (fallbackProfiles.error) {
      console.error("Profile query failed:", fallbackProfiles.error.message);
      throw new Error("Group member names could not be loaded.");
    }
    profiles = (fallbackProfiles.data ?? []).map((profile) => ({
      ...profile,
      avatar_path: null,
    }));
  } else {
    if (profileResult.error) {
      console.error("Profile query failed:", profileResult.error.message);
      throw new Error("Group member names could not be loaded.");
    }
    profiles = profileResult.data ?? [];
  }
  const profileNamesById = new Map(
    profiles.map((profile) => [profile.id, profile.display_name]),
  );
  const profileNames = new Map(
    profileIds.map((profileId) => [
      profileId,
      profileNamesById.get(profileId) || "Member",
    ]),
  );
  const profileAvatarUrls = new Map<string, string>();
  if (avatarMigrationAvailable) {
    const avatarDisplayGroup =
      groupData.find((group) => group.id === params.group) ??
      groupData.find((group) => group.archived_at === null) ??
      groupData[0];
    const visibleAvatarIds = new Set([
      user.id,
      ...(avatarDisplayGroup?.members.map((member) => member.user_id) ?? []),
    ]);
    const avatarProfiles = profiles.filter(
      (profile): profile is typeof profile & { avatar_path: string } =>
        profile.avatar_path !== null &&
        visibleAvatarIds.has(profile.id),
    );
    const avatarLinks = await Promise.all(
      avatarProfiles.map(async (profile) => {
        const { data, error } = await supabase.storage
          .from("profile-avatars")
          .createSignedUrl(profile.avatar_path, 3600);
        if (error) {
          console.error("Profile photo link could not be created:", error.message);
          throw new Error("A group member profile photo could not be loaded.");
        }
        return [profile.id, data.signedUrl] as const;
      }),
    );
    for (const [profileId, signedUrl] of avatarLinks) {
      profileAvatarUrls.set(profileId, signedUrl);
    }
  }
  const groupsWithNames = groupData.map((group) => ({
    ...group,
    members: group.members.map((member) => ({
      id: member.user_id,
      name: profileNames.get(member.user_id) ?? "Member",
      avatarUrl: profileAvatarUrls.get(member.user_id) ?? null,
    })),
    expenses: group.expenses.map((expense) => ({
      ...expense,
      payerName: profileNames.get(expense.payer_id) ?? "Member",
    })),
  }));
  const activeGroups = groupsWithNames.filter((group) => group.archived_at === null);
  const selectedGroup =
    groupsWithNames.find((group) => group.id === params.group) ??
    groupsWithNames.find((group) => group.archived_at === null) ??
    groupsWithNames[0];
  const isSelectedGroupArchived = selectedGroup?.archived_at !== null && selectedGroup !== undefined;
  const canArchiveSelectedGroup =
    archiveMigrationAvailable &&
    selectedGroup?.created_by === user.id &&
    !isSelectedGroupArchived &&
    selectedGroup.balances.every((balance) => balance.balance_minor === 0);
  const celebrateSettlement =
    params.notice === "settlement-recorded" &&
    Boolean(params.celebration) &&
    selectedGroup?.balances.every((balance) => balance.balance_minor === 0);

  const name = profileNames.get(user.id) ?? "Member";
  const amountsByCurrency = groupData.reduce(
    (totals, group) => {
      const balance =
        group.balances.find((entry) => entry.user_id === user.id)?.balance_minor ?? 0;
      const currencyTotal = totals.get(group.currency) ?? { owed: 0, collecting: 0 };
      if (balance < 0) currencyTotal.owed += -balance;
      if (balance > 0) currencyTotal.collecting += balance;
      totals.set(group.currency, currencyTotal);
      return totals;
    },
    new Map<string, { owed: number; collecting: number }>(),
  );
  const formatCurrencyTotals = (key: "owed" | "collecting") =>
    Array.from(amountsByCurrency.entries())
      .filter(([, values]) => values[key] > 0)
      .map(([currency, values]) => formatMoney(values[key], currency))
      .join(" · ") || formatMoney(0, "INR");

  if (inviteToken && !groupsWithNames.some((group) => group.id === params.group)) {
    return (
      <main className="invite-join-page">
        <div className="invite-join-card">
          <Link className="brand brand-dark" href="/">
            <BrandLogo sizes="138px" />
          </Link>
          <div className="eyebrow">YOU’RE INVITED</div>
          <h1>There’s room at the table.</h1>
          <p className="muted">Join the group to see shared expenses and balances.</p>
          <form action={joinGroup}>
            <input name="token" type="hidden" value={inviteToken} />
            <PendingButton pendingLabel="Joining…">Join this group <span aria-hidden="true">↗</span></PendingButton>
          </form>
        </div>
      </main>
    );
  }

  const currentBalance =
    selectedGroup?.balances.find((balance) => balance.user_id === user.id)
      ?.balance_minor ?? 0;
  const activeGroupTotal = selectedGroup
    ? selectedGroup.expenses.reduce((total, expense) => total + expense.amount_minor, 0)
    : 0;

  return (
    <AppShell activePage="overview" groupId={selectedGroup?.id}>
      <SettlementCelebration
        celebrationId={celebrateSettlement ? params.celebration : undefined}
      />
          {!optionalMigrationsAvailable && (
            <OptionalMigrationsNotice
              archiveAvailable={archiveMigrationAvailable}
              discoveryAvailable={
                visibilityMigrationAvailable && openGroupDiscoveryAvailable
              }
            />
          )}
          {(params.error || params.notice) && (
            <div className={`notice-banner ${params.error ? "notice-error" : ""}`} role="status">
              <span>{params.error ? errorMessages[params.error] ?? "Something went wrong." : noticeMessages[params.notice ?? ""]}</span>
              <Link href={selectedGroup ? `/?group=${selectedGroup.id}` : "/"} aria-label="Dismiss">×</Link>
            </div>
          )}

          <section className="welcome-banner" id="overview">
            <div className="welcome-copy">
              <div className="eyebrow">
                {new Date().toLocaleDateString("en-IN", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).toUpperCase()}
              </div>
              <h1>Welcome back, {name.split(" ")[0]} <span className="wave">✳</span></h1>
              <p>Your balances and shared groups, all in one place.</p>
            </div>
          </section>

          {inviteToken && (
            <section className="invite-inline">
              <div>
                <span className="eyebrow">GROUP INVITATION</span>
                <h2>Join your friends’ group</h2>
                <p className="muted">This invite link is ready to use.</p>
              </div>
              <form action={joinGroup}>
                <input name="token" type="hidden" value={inviteToken} />
                <PendingButton pendingLabel="Joining…">Join group ↗</PendingButton>
              </form>
            </section>
          )}

          {params.step === "first-expense" && selectedGroup && !isSelectedGroupArchived && (
            <section className="panel first-expense-panel" id="first-expense-step">
              <div className="panel-heading">
                  <div>
                    <div className="eyebrow">STEP 1 · START SHARING</div>
                    <h2>Add your first expense · {selectedGroup.name}</h2>
                  </div>
                <Link className="button button-text button-small" href={`/?group=${selectedGroup.id}`}>
                  Do this later
                </Link>
              </div>
              {selectedGroup.members.length === 1 && (
                <div className="first-expense-tip">
                  Invite people to this group first, or add an expense now and split it with the members who have joined.
                </div>
              )}
              {selectedGroup.created_by === user.id && (
                <div className="first-expense-invite">
                  <InviteForm
                    activeInvites={selectedGroup.invites}
                    groupId={selectedGroup.id}
                    phoneSearchAvailable={phoneSearchAvailable}
                  />
                </div>
              )}
              <ExpenseComposer
                key={`first-${selectedGroup.id}`}
                currentUserId={user.id}
                currency={selectedGroup.currency}
                firstExpenseStep
                groupId={selectedGroup.id}
                members={selectedGroup.members}
              />
            </section>
          )}

          <section className="summary-grid" aria-label="Your overall balances">
            <Link
              aria-label="View who you owe and the group for each amount"
              className="summary-card summary-card-light summary-card-link summary-card-overall"
              href="/balances?direction=owe"
            >
              <div className="summary-label">YOU OWE · ALL GROUPS</div>
              <strong className="summary-total">{formatCurrencyTotals("owed")}</strong>
              <span className="summary-caption"><span className="tiny-arrow down">↘</span> See who and where</span>
            </Link>
            <Link
              aria-label="View who owes you and the group for each amount"
              className="summary-card summary-card-light summary-card-accent summary-card-link summary-card-overall"
              href="/balances?direction=owed"
            >
              <div className="summary-label">OWED TO YOU · ALL GROUPS</div>
              <strong className="summary-total">{formatCurrencyTotals("collecting")}</strong>
              <span className="summary-caption"><span className="tiny-arrow up">↗</span> See who and where</span>
            </Link>
          </section>

          <section
            aria-labelledby="group-switcher-heading"
            className="panel group-switcher-panel"
            id="group-switcher"
          >
            <div className="group-switcher-intro">
              <div className="eyebrow">YOUR WORKSPACE</div>
              <h2 id="group-switcher-heading">Groups</h2>
              <p>Select an active group or create a new one.</p>
            </div>
            <div className="group-switcher-controls">
              <form action="/" className="group-select-form" method="get">
                <label htmlFor="active-group-select">Active group</label>
                <div className="group-select-row">
                  <select
                    defaultValue={selectedGroup?.archived_at === null ? selectedGroup.id : ""}
                    id="active-group-select"
                    name="group"
                    required
                    disabled={activeGroups.length === 0}
                  >
                    <option disabled value="">Choose an active group</option>
                    {activeGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-outline button-small"
                    disabled={activeGroups.length === 0}
                    type="submit"
                  >
                    Open
                  </button>
                </div>
              </form>
              <details
                className="group-create-disclosure"
                open={["group-details", "group-create", "group-create-rpc-setup"].includes(params.error ?? "")}
              >
                <summary>
                  <span>Create a group</span>
                  <span aria-hidden="true">＋</span>
                </summary>
                <form action={createGroup} className="group-create-form">
                  <label>
                    Group name
                    <input
                      autoComplete="off"
                      maxLength={80}
                      name="name"
                      placeholder="The summer trip"
                      required
                    />
                  </label>
                  <label>
                    Currency
                    <select defaultValue="INR" name="currency">
                      {["INR", "USD", "EUR", "GBP", "CAD", "AUD"].map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </label>
                  <PendingButton className="button button-dark button-small" pendingLabel="Creating…">
                    Create
                  </PendingButton>
                </form>
                <small className="form-hint">Invite up to 40 members after creating.</small>
              </details>
            </div>
          </section>

          <div className="dashboard-grid">
            <section className="panel group-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">YOUR PEOPLE</div>
                  <h2>{selectedGroup?.name ?? "Start with a group"}</h2>
                  {selectedGroup && (
                    <span className="group-visibility-label">
                      {isSelectedGroupArchived
                        ? "Archived · history is read-only"
                        : !visibilityMigrationAvailable
                          ? "Group visibility setup pending"
                          : selectedGroup.is_public
                            ? "Open · signed-in users can discover and join"
                            : "Private · invite required"}
                    </span>
                  )}
                </div>
                {selectedGroup && (
                  <div className="group-panel-actions">
                    <span className="member-count">{selectedGroup.members.length} / 40 people</span>
                    {visibilityMigrationAvailable &&
                      openGroupDiscoveryAvailable &&
                      selectedGroup.created_by === user.id &&
                      !isSelectedGroupArchived && (
                        <form action={setGroupPublic}>
                          <input name="groupId" type="hidden" value={selectedGroup.id} />
                          <input
                            name="isPublic"
                            type="hidden"
                            value={String(!selectedGroup.is_public)}
                          />
                          <PendingButton className="button button-outline button-small" pendingLabel="Updating…">
                            {selectedGroup.is_public ? "Make private" : "Open to join"}
                          </PendingButton>
                        </form>
                      )}
                    {selectedGroup.created_by === user.id && !isSelectedGroupArchived && (
                      <InviteForm
                        activeInvites={selectedGroup.invites}
                        groupId={selectedGroup.id}
                        phoneSearchAvailable={phoneSearchAvailable}
                      />
                    )}
                    {canArchiveSelectedGroup && (
                      <form action={archiveGroup}>
                        <input name="groupId" type="hidden" value={selectedGroup.id} />
                        <PendingButton className="button button-outline button-small" pendingLabel="Archiving…">
                          Archive settled group
                        </PendingButton>
                      </form>
                    )}
                    {archiveMigrationAvailable &&
                      selectedGroup.created_by === user.id &&
                      !isSelectedGroupArchived &&
                      !canArchiveSelectedGroup && (
                        <span className="archive-hint">Settle all balances to archive</span>
                      )}
                  </div>
                )}
              </div>

              {selectedGroup ? (
                <>
                  {isSelectedGroupArchived && (
                    <div className="archived-readonly-note">
                      This group is archived. Expenses, balances, and receipts are kept as read-only history.
                    </div>
                  )}
                  <div className="member-strip">
                    {selectedGroup.members.slice(0, 7).map((member, index) => (
                      <div className="member-avatar-wrap" key={member.id} title={member.name}>
                        <ProfileAvatar
                          className={`avatar-color-${index % 5}`}
                          imageUrl={member.avatarUrl}
                          initials={initials(member.name)}
                        />
                      </div>
                    ))}
                    <span className="member-name-list">
                      {selectedGroup.members.map((member) => member.name).join(" · ")}
                    </span>
                  </div>
                  <div className="group-stats">
                    <div><span>RECENT SPEND</span><b>{formatMoney(activeGroupTotal, selectedGroup.currency)}</b></div>
                    <div><span>YOUR POSITION</span><b className={currentBalance > 0 ? "text-positive" : currentBalance < 0 ? "text-negative" : ""}>
                      {currentBalance > 0 ? "+" : ""}{formatMoney(currentBalance, selectedGroup.currency)}
                    </b></div>
                    <div><span>THIS GROUP</span><b>{selectedGroup.members.length} members</b></div>
                  </div>
                  <div className="balance-list">
                    {selectedGroup.members.map((member, index) => {
                      const memberBalance =
                        selectedGroup.balances.find((entry) => entry.user_id === member.id)
                          ?.balance_minor ?? 0;
                      return (
                        <div className="balance-row" key={member.id}>
                          <ProfileAvatar
                            className={`avatar-color-${index % 5}`}
                            imageUrl={member.avatarUrl}
                            initials={initials(member.name)}
                          />
                          <span className="balance-person">
                            <b>{member.name}{member.id === user.id ? " · you" : ""}</b>
                            <small>{memberBalance > 0 ? "is owed" : memberBalance < 0 ? "owes" : "all settled"}</small>
                          </span>
                          <strong className={memberBalance > 0 ? "text-positive" : memberBalance < 0 ? "text-negative" : "text-neutral"}>
                            {formatMoney(Math.abs(memberBalance), selectedGroup.currency)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-group-state">
                  <span className="empty-illustration">✳</span>
                  <p>Your shared plans start here.</p>
                  <span>Create a group, invite your people, and keep every shared cost in one place.</span>
                </div>
              )}
              {params.step !== "first-expense" && (
                <section aria-labelledby="people-expense-heading" className="people-expense" id="add-expense">
                  <div className="people-expense-heading">
                    <div>
                      <div className="eyebrow">SHARE IT WITH YOUR PEOPLE</div>
                      <h3 id="people-expense-heading">
                        {isSelectedGroupArchived ? "Expense history" : "Add an expense"}
                      </h3>
                    </div>
                    <span className="panel-emoji">✦</span>
                  </div>
                  {selectedGroup && !isSelectedGroupArchived ? (
                    <ExpenseComposer
                      key={selectedGroup.id}
                      groupId={selectedGroup.id}
                      currency={selectedGroup.currency}
                      currentUserId={user.id}
                      members={selectedGroup.members}
                    />
                  ) : isSelectedGroupArchived ? (
                    <p className="muted">Archived groups are read-only. Their activity is preserved alongside this group.</p>
                  ) : (
                    <p className="muted">Create a group to start adding shared expenses.</p>
                  )}
                </section>
              )}
            </section>

            <section className="panel settle-panel" id="settle">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">A CLEAN SLATE</div>
                  <h2>Simplify & settle</h2>
                  {selectedGroup && (
                    <span className="settle-group-label">
                      For {selectedGroup.name} only
                    </span>
                  )}
                </div>
                <span className="settle-sparkle">✳</span>
              </div>
              {selectedGroup && selectedGroup.suggestions.length > 0 ? (
                <>
                  <p className="panel-description">
                    These suggestions use {selectedGroup.name} balances only and change them when recorded.
                  </p>
                  <div className="suggestion-list">
                    {selectedGroup.suggestions.map((suggestion) => {
                      const debtor = selectedGroup.members.find((member) => member.id === suggestion.from_user_id);
                      const creditor = selectedGroup.members.find((member) => member.id === suggestion.to_user_id);
                      if (!debtor || !creditor) return null;
                      return (
                        <details className="suggestion-item" key={`${suggestion.from_user_id}-${suggestion.to_user_id}`}>
                          <summary>
                            <span className="suggestion-avatars">
                              <ProfileAvatar
                                className="avatar-color-1"
                                imageUrl={debtor.avatarUrl}
                                initials={initials(debtor.name)}
                              />
                              <span className="transfer-arrow">→</span>
                              <ProfileAvatar
                                className="avatar-color-3"
                                imageUrl={creditor.avatarUrl}
                                initials={initials(creditor.name)}
                              />
                            </span>
                            <span className="suggestion-names"><b>{debtor.name}</b><small>pays {creditor.name}</small></span>
                            <strong>{formatMoney(suggestion.amount_minor, selectedGroup.currency)}</strong>
                          </summary>
                          {!isSelectedGroupArchived && (
                            <div className="suggestion-actions">
                            <SettlementForm
                              amountMinor={suggestion.amount_minor}
                              currency={selectedGroup.currency}
                              fromUserId={debtor.id}
                              groupId={selectedGroup.id}
                              toUserId={creditor.id}
                            />
                            {creditor.id === user.id && (
                              <form action={sendReminder} className="settlement-reminder-form">
                                <input name="groupId" type="hidden" value={selectedGroup.id} />
                                <input name="recipientId" type="hidden" value={debtor.id} />
                                <label>
                                  Reminder message
                                  <textarea
                                    defaultValue={`${name} requests ${formatMoney(suggestion.amount_minor, selectedGroup.currency)} for ${selectedGroup.name}.`}
                                    maxLength={280}
                                    name="message"
                                    required
                                    rows={2}
                                  />
                                </label>
                                <PendingButton className="button button-text button-small" pendingLabel="Sending…">
                                  Remind {debtor.name} to settle
                                </PendingButton>
                              </form>
                            )}
                            </div>
                          )}
                        </details>
                      );
                    })}
                  </div>
                  <p className="algorithm-note">A simple suggestion, never an automatic payment.</p>
                </>
              ) : (
                <div className="settled-empty">
                  <span className="settled-check">✓</span>
                  <b>{selectedGroup ? "Everyone is even." : "Your balances will appear here."}</b>
                  <span>{selectedGroup ? "Enjoy the moment. The math is handled." : "Add a group and your settle-up options will show here."}</span>
                </div>
              )}
            </section>
          </div>

          <footer className="app-footer">
            <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
            <span>Amounts stored securely · {groupsWithNames.length} groups · <a href="mailto:helpdesk_settlr@gmail.com">Support</a></span>
          </footer>
    </AppShell>
  );
}
