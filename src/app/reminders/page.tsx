import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PendingButton } from "@/components/pending-button";
import { markReminderRead } from "@/app/groups/actions";
import { createClient } from "@/lib/supabase/server";

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; group?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Freminders");

  const { data: reminders, error } = await supabase
    .from("reminders")
    .select("id, group_id, created_by, message, read_at, created_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Reminder query failed:", error.message);
    throw new Error("Your reminders could not be loaded.");
  }

  const groupIds = [...new Set(reminders.map((item) => item.group_id))];
  const senderIds = [...new Set(reminders.map((item) => item.created_by))];
  const [groupsResult, profilesResult] = await Promise.all([
    groupIds.length
      ? supabase.from("groups").select("id, name").in("id", groupIds)
      : Promise.resolve({ data: [], error: null }),
    senderIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", senderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (groupsResult.error) {
    console.error("Reminder group lookup failed:", groupsResult.error.message);
    throw new Error("Reminder groups could not be loaded.");
  }
  if (profilesResult.error) {
    console.error("Reminder sender lookup failed:", profilesResult.error.message);
    throw new Error("Reminder senders could not be loaded.");
  }
  const groupNames = new Map((groupsResult.data ?? []).map((group) => [group.id, group.name]));
  const senderNames = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.display_name]));

  return (
    <AppShell activePage="reminders" groupId={params.group}>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="eyebrow">A FRIENDLY NUDGE</div>
          <h1>Your reminders</h1>
          <p>Settlement requests sent to you by people in your groups.</p>
        </div>
      </section>
      {params.error && (
        <p aria-live="polite" className="form-message form-error" role="alert">
          {params.error === "reminder-details"
            ? "Choose a valid reminder."
            : "The reminder could not be marked as read. Try again."}
        </p>
      )}
      {reminders.length ? (
        <section className="panel reminders-panel">
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <article className={`reminder-row ${reminder.read_at ? "notification-read" : "notification-unread"}`} key={reminder.id}>
                <span className="reminder-symbol">↗</span>
                <div>
                  <b>{groupNames.get(reminder.group_id) ?? "Your group"}</b>
                  <p>{reminder.message}</p>
                  <small>
                    From {senderNames.get(reminder.created_by) ?? "A group member"} ·{" "}
                    {new Date(reminder.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </small>
                </div>
                {!reminder.read_at && (
                  <form action={markReminderRead}>
                    <input name="reminderId" type="hidden" value={reminder.id} />
                    <PendingButton ariaLabel="Mark reminder as read" className="dismiss-reminder" pendingLabel="…">
                      ✓
                    </PendingButton>
                  </form>
                )}
              </article>
            ))}
          </div>
          <p className="privacy-note">Reminders stay in the app. No email or SMS is sent.</p>
        </section>
      ) : (
        <section className="panel activity-empty">
          <span>☼</span>
          <b>No reminders yet</b>
          <small>Settlement requests from your group will appear here.</small>
        </section>
      )}
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
      </footer>
    </AppShell>
  );
}
