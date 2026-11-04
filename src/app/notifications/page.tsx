import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PendingButton } from "@/components/pending-button";
import { markSettlementNotificationRead } from "@/app/notifications/actions";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ error?: string; group?: string }>;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fnotifications");

  const { data: notifications, error } = await supabase
    .from("settlement_notifications")
    .select("id, settlement_id, group_name, currency, from_user_id, amount_minor, read_at, created_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error && !["PGRST205", "42P01"].includes(error.code)) {
    console.error("Settlement notification query failed:", error.message);
    throw new Error("Your settlement notifications could not be loaded.");
  }

  const senderIds = [...new Set((notifications ?? []).map((item) => item.from_user_id))];
  const profileResult = senderIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", senderIds)
    : { data: [], error: null };
  if (profileResult.error) {
    console.error("Settlement notification sender lookup failed:", profileResult.error.message);
    throw new Error("Settlement notification details could not be loaded.");
  }
  const names = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]));

  return (
    <AppShell activePage="notifications" groupId={params.group}>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="eyebrow">YOUR INBOX</div>
          <h1>Settlement notifications</h1>
          <p>When someone records a payment to you, its amount and group appear here.</p>
        </div>
      </section>
      {params.error && (
        <p aria-live="polite" className="form-message form-error" role="alert">
          {params.error === "notification-details"
            ? "Choose a valid notification."
            : "The notification could not be marked as read. Try again."}
        </p>
      )}
      {error ? (
        <section className="panel" role="status">
          Apply the settlement-notifications-and-filtered-transactions migration to enable settlement notifications.
        </section>
      ) : notifications?.length ? (
        <section aria-label="Settlement notifications" className="panel reminders-panel">
          <div className="reminder-list">
            {notifications.map((notification) => (
              <article
                className={`reminder-row ${notification.read_at ? "notification-read" : "notification-unread"}`}
                key={notification.id}
              >
                <span className="reminder-symbol">⇄</span>
                <div>
                  <b>{names.get(notification.from_user_id) ?? "A group member"} paid you</b>
                  <p>
                    {formatMoney(notification.amount_minor, notification.currency)} · {notification.group_name}
                  </p>
                  <small>
                    {new Date(notification.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </small>
                </div>
                {!notification.read_at && (
                  <form action={markSettlementNotificationRead}>
                    <input name="notificationId" type="hidden" value={notification.id} />
                    <PendingButton ariaLabel="Mark notification as read" className="dismiss-reminder" pendingLabel="…">
                      ✓
                    </PendingButton>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel activity-empty">
          <span>☼</span>
          <b>No settlement notifications yet</b>
          <small>Payments recorded to you will appear here.</small>
        </section>
      )}
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
      </footer>
    </AppShell>
  );
}
