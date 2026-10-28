"use client";

import { useActionState } from "react";
import {
  requestPasswordReset,
  updatePassword,
  type AuthState,
} from "@/app/auth/actions";

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
      <button className="button button-primary auth-submit" disabled={pending || !enabled}>
        {!enabled ? "Supabase setup required" : pending ? "Sending…" : "Send reset link"}
      </button>
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
      <button className="button button-primary auth-submit" disabled={pending || !enabled}>
        {!enabled ? "Supabase setup required" : pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
