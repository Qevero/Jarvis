import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { Ctx } from "@/lib/ctx";

/** Encrypted OAuth token storage for Xero and Microsoft (AES-256-GCM, VAULT_ENCRYPTION_KEY). */

export type Provider = "xero" | "microsoft";

export type Connection = {
  provider: Provider;
  status: "active" | "needs_reconnect" | "disconnected";
  accountLabel: string | null;
  tenantId: string | null;
  tenantName: string | null;
  scopes: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  connectedAt: string;
  lastError: string | null;
};

export async function getConnection(ctx: Ctx, provider: Provider): Promise<Connection | null> {
  const { data, error } = await ctx.sb.from("integration_connections").select("*").eq("owner_id", ctx.ownerId).eq("provider", provider).maybeSingle();
  if (error) throw new Error(`Reading ${provider} connection: ${error.message}`);
  if (!data) return null;
  const key = env.vaultKey();
  return {
    provider,
    status: data.status,
    accountLabel: data.account_label,
    tenantId: data.tenant_id,
    tenantName: data.tenant_name,
    scopes: data.scopes,
    accessToken: data.access_token_enc ? decrypt(data.access_token_enc, key) : null,
    refreshToken: data.refresh_token_enc ? decrypt(data.refresh_token_enc, key) : null,
    accessExpiresAt: data.access_expires_at,
    connectedAt: data.connected_at,
    lastError: data.last_error,
  };
}

/** Public status (no tokens) for the dashboard. */
export async function connectionStatus(ctx: Ctx, provider: Provider) {
  const { data } = await ctx.sb
    .from("integration_connections")
    .select("status, account_label, tenant_name, connected_at, last_error, scopes")
    .eq("owner_id", ctx.ownerId)
    .eq("provider", provider)
    .maybeSingle();
  return data as { status: string; account_label: string | null; tenant_name: string | null; connected_at: string; last_error: string | null; scopes: string | null } | null;
}

export async function saveTokens(
  ctx: Ctx,
  provider: Provider,
  t: { accessToken: string; refreshToken?: string | null; expiresIn: number; scopes?: string | null; accountLabel?: string | null; tenantId?: string | null; tenantName?: string | null },
) {
  const key = env.vaultKey();
  const row: Record<string, unknown> = {
    owner_id: ctx.ownerId,
    provider,
    status: "active",
    access_token_enc: encrypt(t.accessToken, key),
    access_expires_at: new Date(Date.now() + (t.expiresIn - 60) * 1000).toISOString(),
    last_error: null,
  };
  if (t.refreshToken) row.refresh_token_enc = encrypt(t.refreshToken, key);
  if (t.scopes !== undefined) row.scopes = t.scopes;
  if (t.accountLabel !== undefined) row.account_label = t.accountLabel;
  if (t.tenantId !== undefined) row.tenant_id = t.tenantId;
  if (t.tenantName !== undefined) row.tenant_name = t.tenantName;
  const { error } = await ctx.sb.from("integration_connections").upsert(row, { onConflict: "owner_id,provider" });
  if (error) throw new Error(`Saving ${provider} tokens: ${error.message}`);
}

export async function markConnection(ctx: Ctx, provider: Provider, status: Connection["status"], lastError: string | null) {
  const patch: Record<string, unknown> = { status, last_error: lastError?.slice(0, 500) ?? null };
  if (status === "disconnected") {
    patch.access_token_enc = null;
    patch.refresh_token_enc = null;
  }
  await ctx.sb.from("integration_connections").update(patch).eq("owner_id", ctx.ownerId).eq("provider", provider);
}

export class NotConnectedError extends Error {
  constructor(public provider: Provider) {
    super(
      provider === "xero"
        ? "Xero isn't connected. Connect it in Jarvis → Settings → Integrations."
        : "Microsoft (Outlook, Calendar, To Do) isn't connected. Connect it in Jarvis → Settings → Integrations.",
    );
  }
}

export class ReconnectError extends Error {
  constructor(public provider: Provider) {
    super(`${provider === "xero" ? "Xero" : "Microsoft"} needs reconnecting in Jarvis → Settings → Integrations.`);
  }
}
