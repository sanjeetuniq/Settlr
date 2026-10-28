import Link from "next/link";
import { PasswordResetRequestForm } from "@/components/password-reset-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <Link className="brand brand-dark" href="/">
        <span aria-hidden="true" className="brand-mark">S</span>
        SETTLR
      </Link>
      <section className="auth-card">
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h1>Forgot your password?</h1>
        <p className="muted">We’ll send a secure reset link if the account exists.</p>
        {!isSupabaseConfigured() && (
          <p className="setup-notice">
            Add your Supabase URL and anon key to <code>.env.local</code> to enable
            password recovery.
          </p>
        )}
        <PasswordResetRequestForm enabled={isSupabaseConfigured()} />
      </section>
      <p className="auth-footnote"><Link href="/sign-in">Back to sign in</Link></p>
    </main>
  );
}
