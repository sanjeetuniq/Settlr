"use server";

import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSiteUrl } from "@/lib/site-url";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomInt } from "node:crypto";
import { friendshipQuotes } from "@/lib/friendship-quotes";

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
      emailRedirectTo: `${siteUrl}/auth/callback?flow=signup&next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error) {
    console.error("Supabase sign-up failed:", error.message);
    return { error: "We couldn't create your account. Check the details and try again." };
  }
  if (!data.session) {
    redirect(
      `/sign-in?notice=verify-email&next=${encodeURIComponent(nextPath)}`,
    );
  }

  redirect(nextPath);
}

export async function resendSignupConfirmation(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const nextPath = safeRedirectPath(String(formData.get("next") ?? "/"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const siteUrl = getSiteUrl();
  if (!siteUrl) {
    return { error: "Set NEXT_PUBLIC_SITE_URL before requesting a new link." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?flow=signup&next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error) {
    console.error("Signup confirmation resend failed:", error.message);
    return {
      error: "We couldn't send a fresh verification link. Wait a bit and try again.",
    };
  }

  return {
    success:
      "If that address has an unverified account, a fresh verification link is on its way.",
  };
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
    redirectTo: `${siteUrl}/auth/callback?flow=recovery&next=/reset-password`,
  });
  if (error) {
    console.error("Password reset request failed:", error.message);
    if (/email.*rate limit|rate limit.*email/i.test(error.message)) {
      return {
        error:
          "Supabase has temporarily limited reset emails. Please wait before retrying; the built-in email service allows 2 emails per hour. Custom SMTP can provide a higher limit.",
      };
    }
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

  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) {
    console.error("Password reset session sign-out failed:", signOutError.message);
  }
  redirect("/sign-in?notice=password-updated");
}

export async function setInvitePassword(
  _previousState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const nextPath = safeRedirectPath(String(formData.get("next") ?? ""));
  const nextUrl = new URL(nextPath, "https://settlr.invalid");
  const inviteToken = nextUrl.searchParams.get("invite");

  if (
    nextUrl.pathname !== "/" ||
    !inviteToken ||
    !/^[0-9a-f]{64}$/.test(inviteToken)
  ) {
    return { error: "This group invitation link is invalid. Ask the group creator to send another." };
  }
  if (password.length < 12 || password.length > 72) {
    return { error: "Use a password between 12 and 72 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Open the invitation email link first." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("Invited user password setup failed:", error.message);
    return { error: "Password could not be saved. Open the invitation email link again." };
  }

  redirect(nextPath);
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Supabase sign-out failed:", error.message);
    throw new Error("We couldn't sign you out. Please try again.");
  }

  const cookieStore = await cookies();
  const lastQuoteIndex = Number(cookieStore.get("settlr-last-logout-quote")?.value);
  const quoteIndex =
    Number.isInteger(lastQuoteIndex) &&
    lastQuoteIndex >= 0 &&
    lastQuoteIndex < friendshipQuotes.length
      ? (() => {
          const next = randomInt(friendshipQuotes.length - 1);
          return next >= lastQuoteIndex ? next + 1 : next;
        })()
      : randomInt(friendshipQuotes.length);

  cookieStore.set("settlr-last-logout-quote", String(quoteIndex), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect(`/signed-out?quote=${quoteIndex}`);
}
