"use client";

import { useActionState } from "react";
import { resendSignupConfirmation, type AuthState } from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";

const initialState: AuthState = {};

export function ResendConfirmationForm({ nextPath = "/" }: { nextPath?: string }) {
  const [state, formAction, pending] = useActionState(
    resendSignupConfirmation,
    initialState,
  );

  return (
    <form action={formAction} className="resend-confirmation-form">
      <input name="next" type="hidden" value={nextPath} />
      <label>
        Email address
        <input
          autoComplete="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      {state.error && (
        <p className="form-message form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="form-message form-success" role="status">
          {state.success}
        </p>
      )}
      <PendingButton
        className="button button-outline auth-submit"
        disabled={pending}
        pendingLabel="Sending…"
      >
        Resend verification link
      </PendingButton>
    </form>
  );
}
