import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import dashboardLogo from "../../Images/Logo.png";
import { ExpenseComposer } from "@/components/expense-composer";
import { InviteForm } from "@/components/invite-form";
import { TransactionHistory } from "@/components/transaction-history";
import { WhatsAppSettings } from "@/components/whatsapp-settings";
import { PendingButton } from "@/components/pending-button";
import type { TransactionRow } from "@/app/groups/transaction-actions";
import {
  archiveGroup,
  createGroup,
  joinGroup,
  joinOpenGroup,
  markReminderRead,
  recordSettlement,
  sendReminder,
  setGroupPublic,
} from "@/app/groups/actions";
import { signOut } from "@/app/auth/actions";
import { friendshipQuotes } from "@/lib/friendship-quotes";
import { formatMoney, simplifyBalances } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

type SearchParams = Promise<{
  group?: string;
  invite?: string;
  notice?: string;
  error?: string;
  step?: string;
}>;

const errorMessages: Record<string, string> = {
  "invite-revoke": "Invite link could not be revoked.",
  "invite-person": "That SETTLR user could not be added to the group.",
  "invite-people-setup": "Apply the group-invites migration in Supabase, then try again.",
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
};

function minorAmountInput(amount: number) {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

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

  const { data: todosData, error: todosError } = await supabase
    .from("todos")
    .select("id, name");
  const todosUnavailable = todosError?.code === "PGRST205";
  if (todosError && !todosUnavailable) {
    console.error("Todo list query failed:", todosError.message);
    throw new Error("Your todos could not be loaded.");
  }
  if (todosUnavailable) {
    console.warn(
      "Todo list unavailable: public.todos was not found by the Supabase Data API. Confirm the table exists and is exposed.",
    );
  }
  const todos = todosData ?? [];

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

  const { data: openGroups, error: openGroupsError } =
    await supabase.rpc("list_open_groups");
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
  const memberGroupIdSet = new Set(memberGroupIds);
  const discoverableGroups = (openGroups ?? []).filter(
    (group) => !memberGroupIdSet.has(group.id),
  );
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

      const expenseIds = expensesResult.data.map((expense) => expense.id);
      let attachments: {
        expense_id: string;
        file_name: string;
        signed_url: string;
      }[] = [];
      if (expenseIds.length > 0) {
        const { data: attachmentRows, error: attachmentsError } = await supabase
          .from("expense_attachments")
          .select("expense_id, file_name, storage_path")
          .in("expense_id", expenseIds);
        if (attachmentsError) {
          console.error("Receipt metadata query failed:", attachmentsError.message);
          throw new Error(`Receipts in ${group.name} could not be loaded.`);
        }
        attachments = await Promise.all(
          attachmentRows.map(async (attachment) => {
            const { data, error } = await supabase.storage
              .from("expense-receipts")
              .createSignedUrl(attachment.storage_path, 60, { download: true });
            if (error) {
              console.error("Receipt link creation failed:", error.message);
              throw new Error(`A receipt in ${group.name} could not be opened.`);
            }
            return {
              expense_id: attachment.expense_id,
              file_name: attachment.file_name,
              signed_url: data.signedUrl,
            };
          }),
        );
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
        attachments,
        invites,
      };
    }),
  );

  const { data: historyData, error: historyQueryError } = await supabase.rpc(
    "get_recent_transactions",
    { p_before_created_at: null, p_before_id: null, p_limit: 21 },
  );
  const transactionRows: TransactionRow[] = historyData ?? [];
  const transactionHistoryError = historyQueryError
    ? ["PGRST202", "42883"].includes(historyQueryError.code)
      ? "Apply the WhatsApp and transaction-history migration to enable combined history."
      : "Recent transactions could not be loaded."
    : undefined;
  if (historyQueryError && !["PGRST202", "42883"].includes(historyQueryError.code)) {
    console.error("Transaction history query failed:", historyQueryError.message);
  }

  let whatsappAvailable = false;
  let whatsappUnavailableMessage: string | undefined;
  let whatsappPreference: {
    phone_e164: string | null;
    phone_verified_at: string | null;
    opted_in_at: string | null;
    expense_alerts: boolean;
    invitation_alerts: boolean;
    reminder_alerts: boolean;
    settlement_alerts: boolean;
  } | null = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("whatsapp_preferences")
      .select("phone_e164, phone_verified_at, opted_in_at, expense_alerts, invitation_alerts, reminder_alerts, settlement_alerts")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error && !["PGRST205", "42P01"].includes(error.code)) {
      console.error("WhatsApp preferences query failed:", error.message);
      whatsappUnavailableMessage =
        "WhatsApp preferences are temporarily unavailable. Your groups and transactions are unaffected.";
    }
    if (!error) {
      whatsappAvailable = true;
      whatsappPreference = data;
    }
  }

  const profileIds = Array.from(
    new Set([
      user.id,
      ...groupData.flatMap((group) => [
        ...group.members.map((member) => member.user_id),
        ...group.expenses.map((expense) => expense.payer_id),
      ]),
      ...transactionRows.flatMap((row) =>
        [row.person_a_id, row.person_b_id].filter(
          (profileId): profileId is string => profileId !== null,
        ),
      ),
    ]),
  );
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", profileIds);
  if (profilesError) {
    console.error("Profile query failed:", profilesError.message);
    throw new Error("Group member names could not be loaded.");
  }
  const profileNames = new Map(
    profiles.map((profile) => [profile.id, profile.display_name]),
  );
  const transactionProfileNames = Object.fromEntries(profileNames);
  const receiptsByExpenseId = Object.fromEntries(
    groupData.flatMap((group) =>
      group.attachments.map((attachment) => [
        attachment.expense_id,
        group.attachments
          .filter((candidate) => candidate.expense_id === attachment.expense_id)
          .map(({ file_name, signed_url }) => ({ file_name, signed_url })),
      ]),
    ),
  );
  const groupsWithNames = groupData.map((group) => ({
    ...group,
    members: group.members.map((member) => ({
      id: member.user_id,
      name: profileNames.get(member.user_id) ?? "Group member",
    })),
    expenses: group.expenses.map((expense) => ({
      ...expense,
      payerName: profileNames.get(expense.payer_id) ?? "Group member",
    })),
  }));
  const activeGroups = groupsWithNames.filter((group) => group.archived_at === null);
  const archivedGroups = groupsWithNames.filter((group) => group.archived_at !== null);
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

  const { data: reminders, error: remindersError } = await supabase
    .from("reminders")
    .select("id, group_id, message, created_at")
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  if (remindersError) {
    console.error("Reminder query failed:", remindersError.message);
    throw new Error("Your reminders could not be loaded.");
  }

  const ownProfile = profiles.find((profile) => profile.id === user.id);
  const name = ownProfile?.display_name || user.email?.split("@")[0] || "friend";
  const welcomeQuote = friendshipQuotes[new Date().getDate() % friendshipQuotes.length];
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
            <span aria-hidden="true" className="brand-mark">S</span>SETTLR
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

  const unreadCount = reminders.length;
  const activeCurrency = selectedGroup?.currency ?? "INR";
  const currentBalance =
    selectedGroup?.balances.find((balance) => balance.user_id === user.id)
      ?.balance_minor ?? 0;
  const activeGroupTotal = selectedGroup
    ? selectedGroup.expenses.reduce((total, expense) => total + expense.amount_minor, 0)
    : 0;

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Link className="brand brand-dark" href="/">
          <span aria-hidden="true" className="brand-mark">S</span>SETTLR
        </Link>
        <div className="sidebar-section-label">YOUR SPACE</div>
        <Link
          className="sidebar-link active"
          href={selectedGroup ? `/?group=${selectedGroup.id}#overview` : "/#overview"}
        >
          <span className="side-icon">◫</span> Overview
        </Link>
        <a className="sidebar-link" href="#activity">
          <span className="side-icon">↗</span> Activity
        </a>
        <a className="sidebar-link" href="#settle">
          <span className="side-icon">⇄</span> Settle up
        </a>
        <div className="sidebar-section-heading">
          <span className="sidebar-section-label">YOUR GROUPS</span>
          <span className="group-count">{activeGroups.length}</span>
        </div>
        <nav className="group-nav" aria-label="Your groups">
          {activeGroups.map((group, index) => (
            <Link
              className={`group-nav-link ${selectedGroup?.id === group.id ? "selected" : ""}`}
              href={`/?group=${group.id}`}
              key={group.id}
            >
              <span className={`group-symbol group-symbol-${index % 4}`}>
                {group.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="group-nav-name">{group.name}</span>
              <span className="group-nav-members">{group.members.length}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-section-heading archive-heading">
          <span className="sidebar-section-label">ARCHIVE</span>
          <span className="group-count">{archivedGroups.length}</span>
        </div>
        {archivedGroups.length > 0 ? (
          <nav aria-label="Archived groups" className="group-nav archive-nav">
            {archivedGroups.map((group, index) => (
              <Link
                className={`group-nav-link ${selectedGroup?.id === group.id ? "selected" : ""}`}
                href={`/?group=${group.id}`}
                key={group.id}
              >
                <span className={`group-symbol group-symbol-${index % 4}`}>
                  {group.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="group-nav-name">{group.name}</span>
                <span aria-label="Archived" className="group-nav-members">✓</span>
              </Link>
            ))}
          </nav>
        ) : (
          <p className="archive-empty">Settled groups will appear here.</p>
        )}
        <div className="sidebar-bottom">
          <div className="privacy-chip"><span>✦</span> You control who can join</div>
          <form action={signOut}>
            <PendingButton className="sidebar-signout" pendingLabel="Signing out…">Sign out <span aria-hidden="true">↗</span></PendingButton>
          </form>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="breadcrumb">
            <Link href={selectedGroup ? `/?group=${selectedGroup.id}` : "/"}>Your space</Link>
            <span aria-hidden="true">/</span>
            <a href="#overview">Overview</a>
          </nav>
          <div className="topbar-actions">
            <a className="notification-link" href="#reminders" aria-label={`${unreadCount} unread reminders`}>
              ♧{unreadCount > 0 && <span className="notification-dot" />}
            </a>
            <Link aria-label="SETTLR dashboard" className="dashboard-logo-link" href="/">
              <Image
                alt="SETTLR"
                className="dashboard-logo"
                height={1254}
                priority
                sizes="42px"
                src={dashboardLogo}
                width={1254}
              />
            </Link>
            <details className="account-menu">
              <summary aria-label="Open account menu" className="user-chip">
                <span className="avatar avatar-current">{initials(name)}</span>
                <span>{name}</span>
                <span aria-hidden="true" className="chevron">⌄</span>
              </summary>
              <div className="account-menu-popover">
                <div className="account-menu-details">
                  <strong>{name}</strong>
                  {user.email && <span>{user.email}</span>}
                </div>
                <form action={signOut}>
                  <PendingButton className="account-menu-signout" pendingLabel="Signing out…">Sign out</PendingButton>
                </form>
              </div>
            </details>
          </div>
        </header>

        <div className="content-area">
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
              <h1>Hey, {name.split(" ")[0]} <span className="wave">✳</span></h1>
              <p>The good stuff is better when the numbers are clear.</p>
              <blockquote>{welcomeQuote}</blockquote>
            </div>
            <a className="button button-primary" href="#add-expense">
              <span aria-hidden="true">＋</span> Add an expense
            </a>
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
                  <h2>Add your first expense</h2>
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
                  />
                </div>
              )}
              <ExpenseComposer
                key={`first-${selectedGroup.id}`}
                currentUserId={user.id}
                firstExpenseStep
                groupId={selectedGroup.id}
                members={selectedGroup.members}
              />
            </section>
          )}

          <section className="summary-grid" aria-label="Your balance summary">
            <article className="summary-card summary-card-main">
              <div className="summary-card-top">
                <span>YOUR BALANCE</span>
                <span className="balance-icon">↗</span>
              </div>
              <strong>{formatMoney(currentBalance, activeCurrency)}</strong>
              <div className="summary-card-bottom">
                <span>
                  {currentBalance > 0
                    ? "You are owed in this group"
                    : currentBalance < 0
                      ? "You owe in this group"
                      : "You are all settled up"}
                </span>
                <span className="balance-pill">{selectedGroup?.name ?? "No group yet"}</span>
              </div>
            </article>
            <article className="summary-card summary-card-light">
              <div className="summary-label">YOU OWE</div>
              <strong className="summary-total">{formatCurrencyTotals("owed")}</strong>
              <span className="summary-caption"><span className="tiny-arrow down">↘</span> Across your groups · grouped by currency</span>
            </article>
            <article className="summary-card summary-card-light summary-card-accent">
              <div className="summary-label">OWED TO YOU</div>
              <strong className="summary-total">{formatCurrencyTotals("collecting")}</strong>
              <span className="summary-caption"><span className="tiny-arrow up">↗</span> Across your groups · grouped by currency</span>
            </article>
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
                        <span className={`avatar avatar-color-${index % 5}`}>{initials(member.name)}</span>
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
                          <span className={`avatar avatar-color-${index % 5}`}>{initials(member.name)}</span>
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
                </div>
                <span className="settle-sparkle">✳</span>
              </div>
              {selectedGroup && selectedGroup.suggestions.length > 0 ? (
                <>
                  <p className="panel-description">
                    Fewer back-and-forths. These suggestions don’t change balances until recorded.
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
                              <span className="avatar avatar-color-1">{initials(debtor.name)}</span>
                              <span className="transfer-arrow">→</span>
                              <span className="avatar avatar-color-3">{initials(creditor.name)}</span>
                            </span>
                            <span className="suggestion-names"><b>{debtor.name}</b><small>pays {creditor.name}</small></span>
                            <strong>{formatMoney(suggestion.amount_minor, selectedGroup.currency)}</strong>
                          </summary>
                          {!isSelectedGroupArchived && (
                            <div className="suggestion-actions">
                            <form action={recordSettlement}>
                              <input name="groupId" type="hidden" value={selectedGroup.id} />
                              <input name="fromUserId" type="hidden" value={debtor.id} />
                              <input name="toUserId" type="hidden" value={creditor.id} />
                              <input name="amount" type="hidden" value={minorAmountInput(suggestion.amount_minor)} />
                              <PendingButton className="button button-primary button-small" pendingLabel="Recording…">Record settlement</PendingButton>
                            </form>
                            {debtor.id !== user.id && (
                              <form action={sendReminder}>
                                <input name="groupId" type="hidden" value={selectedGroup.id} />
                                <input name="recipientId" type="hidden" value={debtor.id} />
                                <input name="message" type="hidden" value={`${name} sent you a reminder to settle up in ${selectedGroup.name}.`} />
                                <PendingButton className="button button-text button-small" pendingLabel="Sending…">Send in-app reminder</PendingButton>
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

          <TransactionHistory
            key={`${selectedGroup?.id ?? "all"}-${transactionRows[0]?.id ?? transactionHistoryError ?? "empty"}`}
            initialError={transactionHistoryError}
            initialHasMore={transactionRows.length > 20}
            initialRows={transactionRows.slice(0, 20)}
            names={transactionProfileNames}
            receipts={receiptsByExpenseId}
          />
          {transactionHistoryError && selectedGroup && (
            <section aria-label="Recent expenses" className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">YOUR GROUP</div>
                  <h2>Recent expenses</h2>
                </div>
                <span className="activity-count">{selectedGroup.expenses.length} recent</span>
              </div>
              {selectedGroup.expenses.map((expense) => (
                <article className="activity-row" key={expense.id}>
                  <span className="activity-category">↗</span>
                  <div className="activity-description">
                    <b>{expense.description}</b>
                    <span>{expense.payerName} paid · {new Date(`${expense.spent_at}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    {selectedGroup.attachments
                      .filter((attachment) => attachment.expense_id === expense.id)
                      .map((attachment) => (
                        <a
                          className="receipt-link"
                          href={attachment.signed_url}
                          key={attachment.file_name}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View receipt · {attachment.file_name}
                        </a>
                      ))}
                  </div>
                  <strong>{formatMoney(expense.amount_minor, selectedGroup.currency)}</strong>
                </article>
              ))}
            </section>
          )}

          <section aria-labelledby="open-groups-heading" className="panel open-groups-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">MEET YOUR PEOPLE</div>
                <h2 id="open-groups-heading">Open groups</h2>
              </div>
            </div>
            <p className="muted">
              Discover groups that are open to anyone with a SETTLR account.
            </p>
            {!openGroupDiscoveryAvailable || !visibilityMigrationAvailable ? (
              <p className="muted small-empty">
                Open-group discovery will be available after the database migrations are applied.
              </p>
            ) : discoverableGroups.length > 0 ? (
              <div className="open-group-list">
                {discoverableGroups.map((group) => (
                  <article className="open-group-row" key={group.id}>
                    <span className="group-symbol group-symbol-0">
                      {group.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="open-group-details">
                      <strong>{group.name}</strong>
                      <span>{group.currency} · Open to join</span>
                    </div>
                    <form action={joinOpenGroup}>
                      <input name="groupId" type="hidden" value={group.id} />
                      <PendingButton className="button button-outline button-small" pendingLabel="Joining…">Join</PendingButton>
                    </form>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted small-empty">No open groups right now.</p>
            )}
          </section>

          <section className="bottom-grid">
            <section className="panel reminders-panel" id="reminders">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">A FRIENDLY NUDGE</div>
                  <h2>Your reminders</h2>
                </div>
                {unreadCount > 0 && <span className="reminder-count">{unreadCount} new</span>}
              </div>
              {reminders.length ? (
                <div className="reminder-list">
                  {reminders.map((reminder) => {
                    const groupName = groupsWithNames.find((group) => group.id === reminder.group_id)?.name ?? "Your group";
                    return (
                      <article className="reminder-row" key={reminder.id}>
                        <span className="reminder-symbol">↗</span>
                        <div><b>{groupName}</b><p>{reminder.message}</p></div>
                        <form action={markReminderRead}>
                          <input name="reminderId" type="hidden" value={reminder.id} />
                          <PendingButton ariaLabel="Mark reminder as read" className="dismiss-reminder" pendingLabel="…">✓</PendingButton>
                        </form>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="muted small-empty">No new nudges. A peaceful little inbox.</p>
              )}
              <p className="privacy-note">Reminders stay in the app. No email or SMS is sent.</p>
            </section>

            <section className="panel create-group-panel">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">NEW ADVENTURE?</div>
                  <h2>Create a group</h2>
                </div>
                <span className="panel-emoji">＋</span>
              </div>
              <form action={createGroup} className="stack-form compact-form">
                <label>
                  Give it a name
                  <input maxLength={80} name="name" placeholder="The summer trip" required />
                </label>
                <label>
                  Group currency
                  <select defaultValue="INR" name="currency">
                    {["INR", "USD", "EUR", "GBP", "CAD", "AUD"].map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
                <PendingButton className="button button-dark" pendingLabel="Creating…">Create group <span aria-hidden="true">↗</span></PendingButton>
                <small className="form-hint">Up to 40 members · invite links expire in 7 days</small>
              </form>
            </section>
          </section>
          <WhatsAppSettings
            alerts={{
              expenses: whatsappPreference?.expense_alerts ?? true,
              invitations: whatsappPreference?.invitation_alerts ?? true,
              reminders: whatsappPreference?.reminder_alerts ?? true,
              settlements: whatsappPreference?.settlement_alerts ?? true,
            }}
            available={whatsappAvailable}
            unavailableMessage={whatsappUnavailableMessage}
            optedIn={Boolean(whatsappPreference?.opted_in_at)}
            phone={whatsappPreference?.phone_e164 ?? null}
            providerConfigured={Boolean(
              process.env.WHATSAPP_ACCESS_TOKEN &&
              process.env.WHATSAPP_PHONE_NUMBER_ID &&
              /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_API_VERSION ?? "") &&
              process.env.WHATSAPP_OTP_TEMPLATE_NAME &&
              process.env.WHATSAPP_ACTIVITY_TEMPLATE_NAME
            )}
            verified={Boolean(whatsappPreference?.phone_verified_at)}
          />
          <section aria-labelledby="todos-heading" className="panel todos-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">YOUR LIST</div>
                <h2 id="todos-heading">Todos</h2>
              </div>
            </div>
            {todosUnavailable ? (
              <p className="muted" role="status">
                Todos are unavailable. Confirm the public.todos table exists and is exposed through the Supabase Data API.
              </p>
            ) : (
              <ul className="todos-list">
                {todos.map((todo) => (
                  <li key={todo.id}>{todo.name}</li>
                ))}
              </ul>
            )}
          </section>
          <footer className="app-footer">
            <span>SETTLR · good company, clear balances</span>
            <span>Amounts stored securely · {groupsWithNames.length} groups · <a href="mailto:helpdesk_settlr@gmail.com">Support</a></span>
          </footer>
        </div>
      </section>
    </main>
  );
}
