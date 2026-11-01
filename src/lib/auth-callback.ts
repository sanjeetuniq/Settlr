export type SupportedOtpType = "email" | "invite" | "recovery" | "signup";

export function getSupportedOtpType(
  type: string | null,
): SupportedOtpType | null {
  if (
    type === "email" ||
    type === "invite" ||
    type === "recovery" ||
    type === "signup"
  ) {
    return type;
  }
  return null;
}

export function isSignupConfirmation(
  flow: string | null,
  otpType: SupportedOtpType | null,
) {
  return flow === "signup" || otpType === "signup" || otpType === "email";
}
