import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const otpType = request.nextUrl.searchParams.get("type");
  const supportedOtpType =
    otpType === "signup" || otpType === "recovery" || otpType === "invite"
      ? otpType
      : null;
  const flow = request.nextUrl.searchParams.get("flow");
  const isSignupConfirmation =
    flow === "signup" || supportedOtpType === "signup";
  const isRecovery = flow === "recovery" || supportedOtpType === "recovery";
  const isInvite = supportedOtpType === "invite";
  const nextPath = safeRedirectPath(
    request.nextUrl.searchParams.get("next") ??
      (isRecovery ? "/reset-password" : null),
  );

  const supabase = await createClient();
  const authResult = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && supportedOtpType
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: supportedOtpType,
        })
      : null;
  if (!authResult) {
    return NextResponse.redirect(new URL("/sign-in?error=auth-callback", request.url));
  }

  const { error } = authResult;
  if (error) {
    console.error("Auth callback failed:", error.message);
    return NextResponse.redirect(new URL("/sign-in?error=auth-callback", request.url));
  }

  if (isSignupConfirmation) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      console.error("Signup confirmation sign-out failed:", signOutError.message);
    }

    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("notice", "email-verified");
    signInUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(signInUrl);
  }

  if (isInvite) {
    const setPasswordUrl = new URL("/set-password", request.url);
    setPasswordUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(setPasswordUrl);
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
