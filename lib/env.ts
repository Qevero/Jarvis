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

const optional = (name: string) => process.env[name] || null;

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, ""),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  /** Secret key: ONLY for scheduled jobs (cron) — never used for user requests. */
  supabaseSecretKey: () => optional("SUPABASE_SECRET_KEY"),
  /** The only email allowed to use Jarvis (dashboard and MCP connector). */
  ownerEmail: () => required("JARVIS_OWNER_EMAIL").trim().toLowerCase(),
  /** 32-byte key, base64 encoded, for encrypting sensitive vault fields and integration tokens. */
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
  cronSecret: () => optional("CRON_SECRET"),

  xero: () => {
    const clientId = optional("XERO_CLIENT_ID");
    const clientSecret = optional("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      scopes:
        optional("XERO_SCOPES") ||
        "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.reports.read accounting.attachments.read",
    };
  },

  microsoft: () => {
    const clientId = optional("MICROSOFT_CLIENT_ID");
    const clientSecret = optional("MICROSOFT_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, tenant: optional("MICROSOFT_TENANT") || "consumers" };
  },

  crm: () => {
    const url = optional("CRM_SUPABASE_URL");
    const key = optional("CRM_SUPABASE_PUBLISHABLE_KEY");
    const token = optional("CRM_CONNECTOR_TOKEN");
    if (!url || !key || !token) return null;
    return { url: url.replace(/\/$/, ""), key, token, appUrl: optional("CRM_APP_URL") };
  },

  companiesHouseKey: () => optional("COMPANIES_HOUSE_API_KEY"),

  vapid: () => {
    const publicKey = optional("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const privateKey = optional("VAPID_PRIVATE_KEY");
    if (!publicKey || !privateKey) return null;
    return { publicKey, privateKey, subject: optional("VAPID_SUBJECT") || "mailto:qevero@outlook.com" };
  },
};

export function mcpResourceUrl(): string {
  return `${env.siteUrl()}/api/mcp`;
}

export function authServerUrl(): string {
  return `${env.supabaseUrl()}/auth/v1`;
}
