import { AuthForm } from "@/components/auth-form";
import { AuthBrand } from "@/components/auth-brand";
import { ResendConfirmationForm } from "@/components/resend-confirmation-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next, error, notice } = await searchParams;
  return (
    <main className="auth-shell">
      <AuthBrand />
      <section className="auth-card">
        <div className="eyebrow">WELCOME BACK</div>
        <h1>Good to see you.</h1>
        <p className="muted">Pick up where your group left off.</p>
        {notice === "verify-email" && (
          <p className="form-message form-success">
            Account created. Verify your email using the link we sent, then sign in here.
          </p>
        )}
        {notice === "email-verified" && (
          <p className="form-message form-success">
            Email verified. Please sign in to continue.
          </p>
        )}
        {notice === "password-updated" && (
          <p className="form-message form-success">
            Password updated. Sign in with your new password.
          </p>
        )}
        {error === "auth-callback" && (
          <>
            <p className="form-message form-error" role="alert">
              That verification link may have expired or already been used. Request a fresh link below.
            </p>
            <ResendConfirmationForm nextPath={next} />
          </>
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
      <p className="auth-footnote">
        Private by default. Your group, your numbers. ·{" "}
        <a href="mailto:helpdesk_settlr@gmail.com">Need help?</a>
      </p>
    </main>
  );
}
