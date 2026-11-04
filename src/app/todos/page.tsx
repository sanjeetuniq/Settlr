import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Ftodos");
  const { data: todos, error } = await supabase.from("todos").select("id, name");
  if (error && error.code !== "PGRST205") {
    console.error("Todo list query failed:", error.message);
    throw new Error("Your todos could not be loaded.");
  }

  return (
    <AppShell activePage="todos" groupId={params.group}>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="eyebrow">YOUR LIST</div>
          <h1>Todos</h1>
          <p>Your personal list, separate from the group dashboard.</p>
        </div>
      </section>
      {error ? (
        <section className="panel" role="status">
          Todos are unavailable. Confirm the public.todos table exists and is exposed through the Supabase Data API.
        </section>
      ) : todos?.length ? (
        <section className="panel todos-panel">
          <ul className="todos-list">
            {todos.map((todo) => <li key={todo.id}>{todo.name}</li>)}
          </ul>
        </section>
      ) : (
        <section className="panel activity-empty">
          <span>☼</span>
          <b>Your list is clear</b>
          <small>There are no todos to show.</small>
        </section>
      )}
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
      </footer>
    </AppShell>
  );
}
