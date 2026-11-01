"use client";

import { useActionState } from "react";
import {
  requestPasswordReset,
  setInvitePassword,
  updatePassword,
  type AuthState,
} from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";

export function PasswordResetRequestForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  return (
    <form action={action} className="auth-form">
      <label>
        Email address
        <input autoComplete="email" name="email" required type="email" />
      </label>
      {state.error && <p className="form-message form-error">{state.error}</p>}
      {state.success && <p className="form-message form-success">{state.success}</p>}
      <PendingButton className="button button-primary auth-submit" disabled={pending || !enabled} pendingLabel="Sending…">
        {!enabled ? "Supabase setup required" : "Send reset link"}
      </PendingButton>
    </form>
  );
}

export function PasswordUpdateForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(updatePassword, {} as AuthState);
  return (
    <form action={action} className="auth-form">
      <label>
        New password
        <input
          autoComplete="new-password"
          minLength={12}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && <p className="form-message form-error">{state.error}</p>}
      <PendingButton className="button button-primary auth-submit" disabled={pending || !enabled} pendingLabel="Updating…">
        {!enabled ? "Supabase setup required" : "Update password"}
      </PendingButton>
    </form>
  );
}

export function InvitePasswordForm({
  enabled,
  nextPath,
}: {
  enabled: boolean;
  nextPath: string;
}) {
  const [state, action, pending] = useActionState(setInvitePassword, {} as AuthState);
  return (
    <form action={action} className="auth-form">
      <input name="next" type="hidden" value={nextPath} />
      <label>
        Create a password
        <input
          autoComplete="new-password"
          minLength={12}
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && <p className="form-message form-error">{state.error}</p>}
      <PendingButton className="button button-primary auth-submit" disabled={pending || !enabled} pendingLabel="Saving…">
        {!enabled ? "Supabase setup required" : "Set password"}
      </PendingButton>
    </form>
  );
}
