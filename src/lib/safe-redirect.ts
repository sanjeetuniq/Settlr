const redirectOrigin = "https://settlr.invalid";

export function safeRedirectPath(value: string | null | undefined) {
  if (!value) return "/";

  try {
    const url = new URL(value, redirectOrigin);
    if (url.origin !== redirectOrigin || !value.startsWith("/") || value.startsWith("//")) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
