import { AppShell } from "@/components/app-shell";
import { PendingButton } from "@/components/pending-button";
import { joinOpenGroup } from "@/app/groups/actions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function OpenGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fgroups%2Fopen");
  const { data: groups, error } = await supabase.rpc("list_open_groups");
  if (error && !["PGRST202", "42883"].includes(error.code)) {
    console.error("Open group discovery query failed:", error.message);
    throw new Error("Open groups could not be loaded.");
  }

  return (
    <AppShell activePage="groups" groupId={params.group}>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="eyebrow">MEET YOUR PEOPLE</div>
          <h1>Open groups</h1>
          <p>Discover groups that are open to anyone with a SETTLR account.</p>
        </div>
      </section>
      {error ? (
        <section className="panel" role="status">
          Open-group discovery will be available after the public-group database migrations are applied.
        </section>
      ) : groups?.length ? (
        <section className="panel open-groups-panel">
          <div className="open-group-list">
            {groups.map((group) => (
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
                  <PendingButton className="button button-outline button-small" pendingLabel="Joining…">
                    Join
                  </PendingButton>
                </form>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel activity-empty">
          <span>☼</span>
          <b>No open groups right now</b>
          <small>Check back later to discover groups you can join.</small>
        </section>
      )}
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
      </footer>
    </AppShell>
  );
}
