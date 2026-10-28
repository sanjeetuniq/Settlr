"use server";

import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";
import { redirect } from "next/navigation";

export type AuthState = {
  error?: string;
  success?: string;
};

export async function signIn(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const nextPath = safeRedirectPath(String(formData.get("next") ?? "/"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Supabase sign-in failed:", error.message);
    return { error: "Sign-in failed. Check your details and try again." };
  }

  redirect(nextPath);
}

export async function signUp(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = safeRedirectPath(String(formData.get("next") ?? "/"));

  if (displayName.length < 1 || displayName.length > 80) {
    return { error: "Your name must be between 1 and 80 characters." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 12 || password.length > 72) {
    return { error: "Use a password between 12 and 72 characters." };
  }

  const supabase = await createClient();
  const siteUrl = getSiteUrl();
  if (!siteUrl) {
    return { error: "Set NEXT_PUBLIC_SITE_URL before creating accounts." };
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error) {
    console.error("Supabase sign-up failed:", error.message);
    return { error: "We couldn't create your account. Check the details and try again." };
  }
  if (!data.session) {
    return {
      success: "Check your inbox to confirm your email and finish creating your account.",
    };
  }

  redirect(nextPath);
}

export async function requestPasswordReset(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const siteUrl = getSiteUrl();
  if (!siteUrl) return { error: "Set NEXT_PUBLIC_SITE_URL before requesting a reset." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });
  if (error) {
    console.error("Password reset request failed:", error.message);
    return { error: "We couldn't send a reset email. Check your address and try again." };
  }

  return {
    success: "If an account exists for that address, a password reset link is on its way.",
  };
}

export async function updatePassword(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 12 || password.length > 72) {
    return { error: "Use a password between 12 and 72 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Open the password reset link first." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("Password update failed:", error.message);
    return { error: "Password could not be updated. Request a new reset link." };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Supabase sign-out failed:", error.message);
    throw new Error("We couldn't sign you out. Please try again.");
  }
  redirect("/sign-in");
}
