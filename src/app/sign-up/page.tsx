import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="auth-shell">
      <Link className="brand brand-dark" href="/">
        <span aria-hidden="true" className="brand-mark">S</span>
        SETTLR
      </Link>
      <section className="auth-card">
        <div className="eyebrow">A LITTLE LESS AWKWARD</div>
        <h1>Good times, clear tabs.</h1>
        <p className="muted">Create an account to start sharing fairly.</p>
        {!isSupabaseConfigured() && (
          <p className="setup-notice">
            Add your Supabase URL and anon key to <code>.env.local</code> to enable
            authentication.
          </p>
        )}
        <AuthForm
          enabled={isSupabaseConfigured()}
          mode="sign-up"
          nextPath={next}
        />
      </section>
      <p className="auth-footnote">Private by default. Your group, your numbers.</p>
    </main>
  );
}
