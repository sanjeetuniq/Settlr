import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { PendingButton } from "@/components/pending-button";
import { ProfileAvatar } from "@/components/profile-avatar";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

const pageLabels = {
  overview: "Overview",
  transactions: "Transactions",
  groups: "Open groups",
  reminders: "Your reminders",
  notifications: "Notifications",
  whatsapp: "WhatsApp notifications",
  todos: "Todos",
} as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AppPage = keyof typeof pageLabels;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export async function AppShell({
  activePage,
  children,
  groupId,
}: {
  activePage: AppPage;
  children: ReactNode;
  groupId?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in");

  const { data: membershipRows, error: membershipsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);
  if (membershipsError) {
    console.error("Navigation group membership lookup failed:", membershipsError.message);
    throw new Error("Your navigation could not be loaded.");
  }

  const groupIds = membershipRows.map((membership) => membership.group_id);
  let groups: { id: string; name: string; archived_at: string | null }[] = [];
  if (groupIds.length) {
    const result = await supabase
      .from("groups")
      .select("id, name, archived_at")
      .in("id", groupIds)
      .order("created_at", { ascending: false });
    if (result.error && ["PGRST204", "PGRST205", "42703"].includes(result.error.code)) {
      const fallback = await supabase
        .from("groups")
        .select("id, name")
        .in("id", groupIds)
        .order("created_at", { ascending: false });
      if (fallback.error) {
        console.error("Navigation groups query failed:", fallback.error.message);
        throw new Error("Your groups could not be loaded.");
      }
      groups = fallback.data.map((group) => ({ ...group, archived_at: null }));
    } else if (result.error) {
      console.error("Navigation groups query failed:", result.error.message);
      throw new Error("Your groups could not be loaded.");
    } else {
      groups = result.data;
    }
  }

  const [profileResult, reminderResult, notificationResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null),
    supabase
      .from("settlement_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null),
  ]);
  if (profileResult.error) {
    console.error("Navigation profile query failed:", profileResult.error.message);
    throw new Error("Your profile could not be loaded.");
  }
  if (reminderResult.error) {
    console.error("Navigation reminder count failed:", reminderResult.error.message);
    throw new Error("Your reminders could not be loaded.");
  }
  if (notificationResult.error && !["PGRST205", "42P01"].includes(notificationResult.error.code)) {
    console.error("Navigation notification count failed:", notificationResult.error.message);
    throw new Error("Your notifications could not be loaded.");
  }

  const name = profileResult.data?.display_name || "Member";
  const selectedGroupId = groupId && uuidPattern.test(groupId) ? groupId : undefined;
  const unreadNotifications = notificationResult.count ?? 0;
  const unreadReminders = reminderResult.count ?? 0;
  const groupContext = selectedGroupId ? `?group=${encodeURIComponent(selectedGroupId)}` : "";
  const navigation = [
    { key: "overview", href: selectedGroupId ? `/?group=${selectedGroupId}` : "/", icon: "◫", label: "Overview" },
    { key: "transactions", href: `/transactions${groupContext}`, icon: "↗", label: "Transactions" },
    { key: "groups", href: `/groups/open${groupContext}`, icon: "▦", label: "Open groups" },
    { key: "reminders", href: `/reminders${groupContext}`, icon: "♧", label: `Your reminders${unreadReminders ? ` (${unreadReminders})` : ""}` },
    { key: "notifications", href: `/notifications${groupContext}`, icon: "●", label: `Notifications${unreadNotifications ? ` (${unreadNotifications})` : ""}` },
    { key: "whatsapp", href: `/settings/whatsapp${groupContext}`, icon: "◎", label: "WhatsApp notifications" },
    { key: "todos", href: `/todos${groupContext}`, icon: "☷", label: "Todos" },
  ] as const;

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <Link className="brand brand-dark" href={selectedGroupId ? `/?group=${selectedGroupId}` : "/"}>
          <BrandLogo sizes="158px" />
        </Link>
        <div className="sidebar-section-label">YOUR SPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              aria-current={activePage === item.key ? "page" : undefined}
              className={`sidebar-link ${activePage === item.key ? "active" : ""}`}
              href={item.href}
              key={item.key}
            >
              <span className="side-icon">{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-section-heading">
          <span className="sidebar-section-label">GROUPS</span>
          <span className="group-count">{groups.filter((group) => group.archived_at === null).length}</span>
        </div>
        <nav aria-label="Your groups" className="group-nav">
          {groups.filter((group) => group.archived_at === null).map((group, index) => (
            <Link
              className={`group-nav-link ${selectedGroupId === group.id ? "selected" : ""}`}
              href={`/?group=${group.id}`}
              key={group.id}
            >
              <span className={`group-symbol group-symbol-${index % 4}`}>
                {group.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="group-nav-name">{group.name}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-section-heading archive-heading">
          <span className="sidebar-section-label">ARCHIVE</span>
          <span className="group-count">{groups.filter((group) => group.archived_at !== null).length}</span>
        </div>
        {groups.some((group) => group.archived_at !== null) ? (
          <nav aria-label="Archived groups" className="group-nav archive-nav">
            {groups.filter((group) => group.archived_at !== null).map((group, index) => (
              <Link
                className={`group-nav-link ${selectedGroupId === group.id ? "selected" : ""}`}
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
            <PendingButton className="sidebar-signout" pendingLabel="Signing out…">
              Sign out <span aria-hidden="true">↗</span>
            </PendingButton>
          </form>
        </div>
      </aside>
      <section className="main-column">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="breadcrumb">
            <Link href={selectedGroupId ? `/?group=${selectedGroupId}` : "/"}>Your space</Link>
            <span aria-hidden="true">/</span>
            <span>{pageLabels[activePage]}</span>
          </nav>
          <div className="topbar-actions">
            <Link
              aria-label={`${unreadNotifications} unread settlement notifications`}
              className="notification-link"
              href={`/notifications${groupContext}`}
            >
              ♧{unreadNotifications > 0 && <span className="notification-dot" />}
            </Link>
            <Link
              aria-label="SETTLR dashboard"
              className="dashboard-logo-link"
              href={selectedGroupId ? `/?group=${selectedGroupId}` : "/"}
            >
              <BrandLogo className="dashboard-logo" priority sizes="42px" />
            </Link>
            <details className="account-menu">
              <summary aria-label="Open account menu" className="user-chip">
                <ProfileAvatar className="avatar-current" imageUrl={null} initials={initials(name)} />
                <span>{name}</span>
                <span aria-hidden="true" className="chevron">⌄</span>
              </summary>
              <div className="account-menu-popover">
                <div className="account-menu-details">
                  <strong>{name}</strong>
                  {user.email && <span>{user.email}</span>}
                </div>
                <Link className="account-menu-settings" href="/settings">Profile settings</Link>
                <form action={signOut}>
                  <PendingButton className="account-menu-signout" pendingLabel="Signing out…">Sign out</PendingButton>
                </form>
              </div>
            </details>
          </div>
        </header>
        <nav aria-label="Mobile navigation" className="mobile-nav">
          {navigation.map((item) => (
            <Link
              aria-current={activePage === item.key ? "page" : undefined}
              className={activePage === item.key ? "active" : ""}
              href={item.href}
              key={item.key}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="content-area">{children}</div>
      </section>
    </main>
  );
}
