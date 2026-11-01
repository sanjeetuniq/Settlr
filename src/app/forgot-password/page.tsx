import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { PasswordResetRequestForm } from "@/components/password-reset-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <AuthBrand />
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
      <p className="auth-footnote">
        <Link href="/sign-in">Back to sign in</Link> ·{" "}
        <a href="mailto:helpdesk_settlr@gmail.com">Support</a>
      </p>
    </main>
  );
}
