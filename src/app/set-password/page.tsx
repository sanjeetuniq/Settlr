import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { InvitePasswordForm } from "@/components/password-reset-form";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = safeRedirectPath((await searchParams).next);
  if (!isSupabaseConfigured()) redirect("/sign-in");

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    console.error("Invited account lookup failed:", error.message);
    redirect("/sign-in");
  }
  if (!user) redirect("/sign-in");

  return (
    <main className="auth-shell">
      <AuthBrand />
      <section className="auth-card">
        <div className="eyebrow">ONE LAST THING</div>
        <h1>Set your password.</h1>
        <p className="muted">Choose a password to secure your SETTLR account and continue to your group.</p>
        <InvitePasswordForm enabled nextPath={nextPath} />
      </section>
      <p className="auth-footnote">
        <Link href="/sign-in">Back to sign in</Link> ·{" "}
        <a href="mailto:helpdesk_settlr@gmail.com">Support</a>
      </p>
    </main>
  );
}
