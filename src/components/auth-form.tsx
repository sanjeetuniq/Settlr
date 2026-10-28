"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthState } from "@/app/auth/actions";

const initialState: AuthState = {};

export function AuthForm({
  mode,
  nextPath = "/",
  enabled = true,
}: {
  mode: "sign-in" | "sign-up";
  nextPath?: string;
  enabled?: boolean;
}) {
  const action = mode === "sign-in" ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, initialState);
  const isSignUp = mode === "sign-up";

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={nextPath} />
      {isSignUp && (
        <label>
          Your name
          <input
            autoComplete="name"
            maxLength={80}
            name="displayName"
            placeholder="Alex Morgan"
            required
          />
        </label>
      )}
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
      <label>
        Password
        <input
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={isSignUp ? 12 : undefined}
          name="password"
          placeholder={isSignUp ? "At least 12 characters" : "Your password"}
          required
          type="password"
        />
      </label>
      {state.error && <p className="form-message form-error">{state.error}</p>}
      {state.success && (
        <p className="form-message form-success">{state.success}</p>
      )}
      <button className="button button-primary auth-submit" disabled={pending || !enabled}>
        {!enabled
          ? "Supabase setup required"
          : pending
            ? "Please wait…"
            : isSignUp
              ? "Create your account"
              : "Sign in"}
      </button>
      {!isSignUp && <Link className="forgot-link" href="/forgot-password">Forgot password?</Link>}
      <p className="auth-switch">
        {isSignUp ? "Already have an account?" : "New to SETTLR?"}{" "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"}>
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
