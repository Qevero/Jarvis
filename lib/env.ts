/**
 * Environment access. All secrets live in Netlify environment variables; see
 * README.md for the full list. Nothing here is ever logged.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See README.md → Environment variables.`);
  }
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, ""),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  /** The only email allowed to use Jarvis (dashboard and MCP connector). */
  ownerEmail: () => required("JARVIS_OWNER_EMAIL").trim().toLowerCase(),
  /** 32-byte key, base64 encoded, for encrypting sensitive vault fields. */
  vaultKey: () => required("VAULT_ENCRYPTION_KEY"),
  /** Public URL of the site, e.g. https://jarvis-qevero.netlify.app (Netlify sets URL automatically). */
  siteUrl: () =>
    (process.env.JARVIS_SITE_URL || process.env.URL || "http://localhost:3000").replace(/\/$/, ""),
  /**
   * OAuth redirect URIs the consent screen will approve. Defaults to Claude's
   * connector callbacks. Comma-separated exact URLs.
   */
  allowedRedirectUris: () =>
    (process.env.OAUTH_ALLOWED_REDIRECT_URIS ||
      "https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};

export function mcpResourceUrl(): string {
  return `${env.siteUrl()}/api/mcp`;
}

export function authServerUrl(): string {
  return `${env.supabaseUrl()}/auth/v1`;
}
