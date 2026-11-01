/** Exact-match check of an OAuth redirect URI against the allowlist (no wildcards). */
export function isAllowedRedirect(redirectUri: string | null | undefined, allowlist: string[]): boolean {
  if (!redirectUri) return false;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "localhost")) return false;
  const normalised = `${parsed.origin}${parsed.pathname}`;
  return allowlist.includes(normalised);
}

/** Same-origin check for form POSTs (CSRF defence on the consent decision). */
export function isSameOrigin(originHeader: string | null, siteUrl: string): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}
