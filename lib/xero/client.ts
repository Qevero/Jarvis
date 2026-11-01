import { env } from "@/lib/env";
import { getPrefs, type Ctx } from "@/lib/ctx";
import { getConnection, markConnection, NotConnectedError, ReconnectError, saveTokens } from "@/lib/integrations/connections";
import { todayUk } from "@/lib/dates";

/**
 * Minimal Xero Accounting API client. Handles token refresh (Xero rotates
 * refresh tokens), a daily call budget (Starter tier), and rate limits.
 */

const IDENTITY = "https://identity.xero.com/connect/token";
const AUTHORIZE = "https://login.xero.com/identity/connect/authorize";
const API = "https://api.xero.com/api.xro/2.0";

export function xeroRedirectUri() {
  return `${env.siteUrl()}/api/integrations/xero/callback`;
}

export function xeroAuthorizeUrl(state: string, codeChallenge: string) {
  const cfg = env.xero();
  if (!cfg) throw new Error("XERO_CLIENT_ID / XERO_CLIENT_SECRET are not set.");
  const u = new URL(AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", xeroRedirectUri());
  u.searchParams.set("scope", cfg.scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = env.xero();
  if (!cfg) throw new Error("Xero is not configured.");
  const res = await fetch(IDENTITY, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Xero token request failed (${res.status}).`);
  return (await res.json()) as TokenResponse;
}

export function exchangeXeroCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: xeroRedirectUri(), code_verifier: verifier });
}

export async function xeroTenants(accessToken: string): Promise<{ tenantId: string; tenantName: string; tenantType: string }[]> {
  const res = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Couldn't list Xero organisations (${res.status}).`);
  return (await res.json()) as { tenantId: string; tenantName: string; tenantType: string }[];
}

export class XeroRateLimitError extends Error {
  constructor(public retryAfterSeconds: number, public which: string) {
    super(`Xero rate limit reached (${which}). Try again in ${retryAfterSeconds}s.`);
  }
}

export class XeroBudgetError extends Error {
  constructor(public budget: number) {
    super(`Jarvis has used today's Xero call budget (${budget}). It resets at midnight UTC; raise it in Settings if your Xero plan allows.`);
  }
}

export class XeroApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export type XeroRequest = {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accept?: string;
  ifModifiedSince?: string | null;
};

export class XeroClient {
  private accessToken: string | null = null;
  private tenantId: string | null = null;
  private calls = 0;

  constructor(private ctx: Ctx) {}

  get callsMade() {
    return this.calls;
  }

  private async token(force = false): Promise<{ token: string; tenant: string }> {
    if (this.accessToken && this.tenantId && !force) return { token: this.accessToken, tenant: this.tenantId };
    const conn = await getConnection(this.ctx, "xero");
    if (!conn || conn.status === "disconnected") throw new NotConnectedError("xero");
    if (conn.status === "needs_reconnect" || !conn.refreshToken || !conn.tenantId) throw new ReconnectError("xero");
    const fresh = conn.accessToken && conn.accessExpiresAt && Date.parse(conn.accessExpiresAt) > Date.now() + 30_000;
    if (fresh && !force) {
      this.accessToken = conn.accessToken;
    } else {
      try {
        const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refreshToken });
        await saveTokens(this.ctx, "xero", { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, scopes: t.scope ?? conn.scopes });
        this.accessToken = t.access_token;
      } catch (e) {
        await markConnection(this.ctx, "xero", "needs_reconnect", e instanceof Error ? e.message : "Token refresh failed");
        throw new ReconnectError("xero");
      }
    }
    this.tenantId = conn.tenantId;
    return { token: this.accessToken!, tenant: this.tenantId };
  }

  private async countCall() {
    const day = todayUk();
    const prefs = await getPrefs(this.ctx);
    const { data } = await this.ctx.sb.from("xero_api_usage").select("calls").eq("owner_id", this.ctx.ownerId).eq("day", day).maybeSingle();
    const used = data?.calls ?? 0;
    if (used >= prefs.xeroDailyCallBudget) throw new XeroBudgetError(prefs.xeroDailyCallBudget);
    await this.ctx.sb.from("xero_api_usage").upsert({ owner_id: this.ctx.ownerId, day, calls: used + 1 }, { onConflict: "owner_id,day" });
    this.calls++;
  }

  async raw(path: string, req: XeroRequest = {}, retried = false): Promise<Response> {
    await this.countCall();
    const { token, tenant } = await this.token();
    const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "xero-tenant-id": tenant, Accept: req.accept ?? "application/json" };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    if (req.ifModifiedSince) headers["If-Modified-Since"] = new Date(req.ifModifiedSince).toUTCString();
    const res = await fetch(url, { method: req.method ?? "GET", headers, body: req.body === undefined ? undefined : JSON.stringify(req.body) });
    if (res.status === 401 && !retried) {
      await this.token(true);
      return this.raw(path, req, true);
    }
    if (res.status === 429) {
      throw new XeroRateLimitError(Number(res.headers.get("retry-after") ?? 60), res.headers.get("x-rate-limit-problem") ?? "minute");
    }
    return res;
  }

  async json<T = Record<string, unknown>>(path: string, req: XeroRequest = {}): Promise<T> {
    const res = await this.raw(path, req);
    if (res.status === 304) return {} as T;
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    if (!res.ok) {
      const b = body as Record<string, unknown>;
      const elements = (b?.Elements as { ValidationErrors?: { Message: string }[] }[] | undefined) ?? [];
      const messages = elements.flatMap((e) => e.ValidationErrors ?? []).map((v) => v.Message);
      throw new XeroApiError(res.status, messages.length ? `Xero rejected the request: ${messages.join("; ")}` : `Xero error ${res.status}: ${String(b?.Message ?? b?.Detail ?? "unknown")}`, body);
    }
    return body as T;
  }
}
