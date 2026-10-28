import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="auth-shell">
      <Link className="brand brand-dark" href="/">
        <span aria-hidden="true" className="brand-mark">S</span>
        SETTLR
      </Link>
      <section className="auth-card">
        <div className="eyebrow">WELCOME BACK</div>
        <h1>Good to see you.</h1>
        <p className="muted">Pick up where your group left off.</p>
        {error === "auth-callback" && (
          <p className="form-message form-error">That sign-in link has expired or could not be verified. Request a fresh link and try again.</p>
        )}
        {error === "session" && (
          <p className="form-message form-error">Your session could not be refreshed. Please sign in again.</p>
        )}
        {!isSupabaseConfigured() && (
          <p className="setup-notice">
            Add your Supabase URL and anon key to <code>.env.local</code> to enable
            authentication.
          </p>
        )}
        <AuthForm
          enabled={isSupabaseConfigured()}
          mode="sign-in"
          nextPath={next}
        />
      </section>
      <p className="auth-footnote">Private by default. Your group, your numbers.</p>
    </main>
  );
}
