import Link from "next/link";
import { redirect } from "next/navigation";
import { ExpenseComposer } from "@/components/expense-composer";
import { InviteForm } from "@/components/invite-form";
import {
  createGroup,
  joinGroup,
  markReminderRead,
  recordSettlement,
  sendReminder,
} from "@/app/groups/actions";
import { signOut } from "@/app/auth/actions";
import { formatMoney, simplifyBalances } from "@/lib/money";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

type SearchParams = Promise<{
  group?: string;
  invite?: string;
  notice?: string;
  error?: string;
}>;

const errorMessages: Record<string, string> = {
  "invite-revoke": "Invite link could not be revoked.",
  "group-details": "Give your group a name and choose a supported currency.",
  "group-create": "Your group could not be created. Please try again.",
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
  "joined-group": "You joined the group. Welcome in!",
  "settlement-recorded": "Settlement recorded and balances updated.",
  "reminder-sent": "In-app reminder sent.",
  "invite-revoked": "Invite link revoked.",
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

function Landing({
  inviteToken,
  configured,
}: {
  inviteToken?: string;
  configured: boolean;
}) {
  const returnTo = inviteToken ? `/?invite=${inviteToken}` : "/";
  const next = `?next=${encodeURIComponent(returnTo)}`;

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link className="brand" href="/">
          <span aria-hidden="true" className="brand-mark">S</span>
          SETTLR
        </Link>
        <nav>
          <Link className="nav-login" href={`/sign-in${next}`}>Sign in</Link>
          <Link className="button button-dark" href={`/sign-up${next}`}>
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> GOOD COMPANY, NO GUESSWORK</div>
          <h1>Make memories.<br /><em>Not spreadsheets.</em></h1>
          <p>
            Shared dinners, weekend escapes, the household shop. Keep the
            numbers clear and the good times easy.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href={`/sign-up${next}`}>
              Start a group <span aria-hidden="true">↗</span>
            </Link>
            <span className="hero-footnote">Free to use · Your data stays yours</span>
          </div>
          {inviteToken && (
            <div className="invite-callout">
              <span className="invite-icon">↗</span>
              <span>You have a group invitation. Sign in or create an account to join.</span>
            </div>
          )}
          {!configured && (
            <div className="setup-notice landing-setup">
              <strong>Supabase setup needed.</strong> Add the project URL and public
              anon key to <code>.env.local</code>, then apply the included migration.
            </div>
          )}
        </div>

        <div aria-label="Example group balance card" className="hero-art">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="floating-note note-top"><span>✦</span> Saturday getaway</div>
          <div className="balance-preview">
            <div className="preview-topline">
              <span>YOUR WEEKEND CREW</span><span className="preview-menu">•••</span>
            </div>
            <div className="preview-title">Cabin weekend <span className="mini-avatar">4</span></div>
            <div className="preview-balance">
              <span>YOU ARE OWED</span>
              <strong>₹ 2,450.00</strong>
            </div>
            <div className="preview-divider" />
            <div className="preview-person">
              <span className="avatar avatar-peach">A</span>
              <span><b>Alex paid for groceries</b><small>Today · Food</small></span>
              <strong>₹ 1,840</strong>
            </div>
            <div className="preview-person">
              <span className="avatar avatar-lilac">J</span>
              <span><b>Jamie settled up</b><small>Yesterday · Payment</small></span>
              <strong className="settled-mark">✓</strong>
            </div>
            <div className="preview-avatars">
              <span className="avatar avatar-mint">M</span>
              <span className="avatar avatar-yellow">S</span>
              <span className="avatar avatar-blue">R</span>
              <span className="preview-members">and 3 friends</span>
            </div>
          </div>
          <div className="floating-note note-bottom"><span>↗</span> all even, all good</div>
        </div>
      </section>

      <section className="landing-benefits">
        <div><span className="benefit-number">01</span><b>One place for every group</b><small>Trips, housemates, dinner plans.</small></div>
        <div><span className="benefit-number">02</span><b>Clear from the first rupee</b><small>See who paid, who owes, and why.</small></div>
        <div><span className="benefit-number">03</span><b>Less chasing, fewer transfers</b><small>Simple settle-up suggestions.</small></div>
      </section>
      <footer className="landing-footer">
        <span>SETTLR © 2026</span><span>Good company. Clear balances.</span>
      </footer>
    </main>
  );
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const inviteToken =
    params.invite && /^[0-9a-f]{64}$/.test(params.invite) ? params.invite : undefined;

  if (!isSupabaseConfigured()) {
    return <Landing inviteToken={inviteToken} configured={false} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Dashboard authentication lookup failed:", authError.message);
    redirect("/sign-in?error=session");
  }
  if (!user) return <Landing inviteToken={inviteToken} configured />;

  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("id, name, currency, created_by, created_at")
    .order("created_at", { ascending: false });
  if (groupsError) {
    console.error("Group list query failed:", groupsError.message);
    throw new Error("Your groups could not be loaded. Please refresh the page.");
  }

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

  const profileIds = Array.from(
    new Set([
      user.id,
      ...groupData.flatMap((group) => [
        ...group.members.map((member) => member.user_id),
        ...group.expenses.map((expense) => expense.payer_id),
      ]),
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
  const selectedGroup =
    groupsWithNames.find((group) => group.id === params.group) ?? groupsWithNames[0];

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
            <button className="button button-primary">Join this group <span aria-hidden="true">↗</span></button>
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
        <Link className="sidebar-link active" href="/">
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
          <span className="group-count">{groupsWithNames.length}</span>
        </div>
        <nav className="group-nav" aria-label="Your groups">
          {groupsWithNames.map((group, index) => (
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
        <div className="sidebar-bottom">
          <div className="privacy-chip"><span>✦</span> Your groups are private</div>
          <form action={signOut}>
            <button className="sidebar-signout">Sign out <span aria-hidden="true">↗</span></button>
          </form>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb">Your space <span>/</span> Overview</div>
          <div className="topbar-actions">
            <a className="notification-link" href="#reminders" aria-label={`${unreadCount} unread reminders`}>
              ♧{unreadCount > 0 && <span className="notification-dot" />}
            </a>
            <div className="user-chip">
              <span className="avatar avatar-current">{initials(name)}</span>
              <span>{name}</span>
              <span className="chevron">⌄</span>
            </div>
            <form action={signOut} className="topbar-signout-form">
              <button className="topbar-signout">Sign out</button>
            </form>
          </div>
        </header>

        <div className="content-area">
          {(params.error || params.notice) && (
            <div className={`notice-banner ${params.error ? "notice-error" : ""}`} role="status">
              <span>{params.error ? errorMessages[params.error] ?? "Something went wrong." : noticeMessages[params.notice ?? ""]}</span>
              <Link href={selectedGroup ? `/?group=${selectedGroup.id}` : "/"} aria-label="Dismiss">×</Link>
            </div>
          )}

          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                {new Date().toLocaleDateString("en-IN", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).toUpperCase()}
              </div>
              <h1>Hey, {name.split(" ")[0]} <span className="wave">✳</span></h1>
              <p className="muted">The good stuff is better when the numbers are clear.</p>
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
                <button className="button button-primary">Join group ↗</button>
              </form>
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
                </div>
                {selectedGroup && (
                  <div className="group-panel-actions">
                    <span className="member-count">{selectedGroup.members.length} / 40 people</span>
                    {selectedGroup.created_by === user.id && (
                      <InviteForm
                        activeInvites={selectedGroup.invites}
                        groupId={selectedGroup.id}
                      />
                    )}
                  </div>
                )}
              </div>

              {selectedGroup ? (
                <>
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
                          <div className="suggestion-actions">
                            <form action={recordSettlement}>
                              <input name="groupId" type="hidden" value={selectedGroup.id} />
                              <input name="fromUserId" type="hidden" value={debtor.id} />
                              <input name="toUserId" type="hidden" value={creditor.id} />
                              <input name="amount" type="hidden" value={minorAmountInput(suggestion.amount_minor)} />
                              <button className="button button-primary button-small">Record settlement</button>
                            </form>
                            {debtor.id !== user.id && (
                              <form action={sendReminder}>
                                <input name="groupId" type="hidden" value={selectedGroup.id} />
                                <input name="recipientId" type="hidden" value={debtor.id} />
                                <input name="message" type="hidden" value={`${name} sent you a reminder to settle up in ${selectedGroup.name}.`} />
                                <button className="button button-text button-small">Send in-app reminder</button>
                              </form>
                            )}
                          </div>
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

          <div className="lower-grid">
            <section className="panel expense-panel" id="add-expense">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">WRITE IT DOWN, MOVE ON</div>
                  <h2>Add an expense</h2>
                </div>
                <span className="panel-emoji">✦</span>
              </div>
              {selectedGroup ? (
                <ExpenseComposer
                  groupId={selectedGroup.id}
                  members={selectedGroup.members}
                />
              ) : (
                <p className="muted">Create a group to start adding shared expenses.</p>
              )}
            </section>

            <section className="panel activity-panel" id="activity">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">THE LATEST</div>
                  <h2>Recent activity</h2>
                </div>
                {selectedGroup && <span className="activity-count">{selectedGroup.expenses.length} recent</span>}
              </div>
              {selectedGroup?.expenses.length ? (
                <div className="activity-list">
                  {selectedGroup.expenses.map((expense) => (
                    <article className="activity-row" key={expense.id}>
                      <span className={`activity-category activity-${expense.category.toLowerCase()}`}>
                        {expense.category === "Food" ? "⌁" : expense.category === "Transport" ? "↗" : expense.category === "Stay" ? "⌂" : "✦"}
                      </span>
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
                </div>
              ) : (
                <div className="activity-empty">
                  <span>☼</span>
                  <b>No expenses yet</b>
                  <small>Your group’s activity will find its home here.</small>
                </div>
              )}
            </section>
          </div>

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
                          <button aria-label="Mark reminder as read" className="dismiss-reminder">✓</button>
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
                <button className="button button-dark">Create group <span aria-hidden="true">↗</span></button>
                <small className="form-hint">Up to 40 members · invite links expire in 7 days</small>
              </form>
            </section>
          </section>
          <footer className="app-footer">
            <span>SETTLR · good company, clear balances</span>
            <span>Amounts stored securely · {groupsWithNames.length} groups</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
