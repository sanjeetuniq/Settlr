import Link from "next/link";
import { PasswordUpdateForm } from "@/components/password-reset-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <Link className="brand brand-dark" href="/">
        <span aria-hidden="true" className="brand-mark">S</span>
        SETTLR
      </Link>
      <section className="auth-card">
        <div className="eyebrow">SECURE YOUR ACCOUNT</div>
        <h1>Choose a new password.</h1>
        <p className="muted">Use at least 12 characters.</p>
        <PasswordUpdateForm enabled={isSupabaseConfigured()} />
      </section>
      <p className="auth-footnote"><Link href="/sign-in">Back to sign in</Link></p>
    </main>
  );
}
