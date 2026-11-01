import { describe, expect, it } from "vitest";
import { ownerCheck } from "@/lib/auth";
import { extractBearer, protectedResourceMetadata, unauthorizedResponse, verifyAccessToken, type TokenClaims } from "@/lib/mcp/auth";
import { isAllowedRedirect, isSameOrigin } from "@/lib/oauth";
import { safeNext } from "@/lib/safe-next";

const ISSUER = "https://abc.supabase.co/auth/v1";
const OWNER = "jasper@qevero.com";
const NOW = 1_800_000_000_000;

const good: TokenClaims = {
  sub: "user-1",
  email: "Jasper@Qevero.com",
  iss: ISSUER,
  exp: NOW / 1000 + 600,
  client_id: "claude-client",
  role: "authenticated",
  aal: "aal1",
};

const verify = (claims: TokenClaims | null) => verifyAccessToken("tok", { getClaims: async () => claims, issuer: ISSUER, ownerEmail: OWNER, now: () => NOW });

describe("MCP access token verification", () => {
  it("accepts the owner's OAuth connector token", async () => {
    const r = await verify(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.auth).toMatchObject({ clientId: "claude-client", expiresAt: good.exp, extra: { userId: "user-1" } });
  });

  it.each([
    ["unverifiable", null, /verified/],
    ["expired", { ...good, exp: NOW / 1000 - 1 }, /expired/],
    ["wrong issuer", { ...good, iss: "https://evil.supabase.co/auth/v1" }, /issued/],
    ["dashboard session token (no client_id)", { ...good, client_id: undefined }, /connector/],
    ["anon role", { ...good, role: "anon" }, /role/],
    ["someone else", { ...good, email: "mallory@example.com" }, /not allowed/],
  ])("rejects %s", async (_label, claims, msg) => {
    const r = await verify(claims as TokenClaims | null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.description).toMatch(msg);
  });

  it("treats a throwing verifier as invalid", async () => {
    const r = await verifyAccessToken("tok", { getClaims: async () => { throw new Error("jwks down"); }, issuer: ISSUER, ownerEmail: OWNER });
    expect(r.ok).toBe(false);
  });

  it("extracts bearer tokens", () => {
    expect(extractBearer("Bearer abc.def-ghi_jkl")).toBe("abc.def-ghi_jkl");
    expect(extractBearer("bearer xyz")).toBe("xyz");
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });

  it("returns a spec-compliant 401 challenge", async () => {
    const res = unauthorizedResponse("https://jarvis.example", "Token has expired.", "invalid_token");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://jarvis.example/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="Token has expired."',
    );
  });

  it("publishes protected resource metadata pointing at Supabase Auth", () => {
    expect(protectedResourceMetadata("https://jarvis.example/api/mcp", ISSUER)).toMatchObject({
      resource: "https://jarvis.example/api/mcp",
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("dashboard owner check", () => {
  it("requires the owner with MFA", () => {
    expect(ownerCheck({ sub: "u", email: OWNER, aal: "aal2" }, OWNER)).toMatchObject({ ok: true });
    expect(ownerCheck({ sub: "u", email: OWNER, aal: "aal1" }, OWNER)).toEqual({ ok: false, reason: "mfa_required" });
    expect(ownerCheck({ sub: "u", email: "x@y.com", aal: "aal2" }, OWNER)).toEqual({ ok: false, reason: "not_owner" });
    expect(ownerCheck(null, OWNER)).toEqual({ ok: false, reason: "signed_out" });
  });
});

describe("OAuth consent safeguards", () => {
  const allow = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
  it("only approves Claude's exact callback URLs", () => {
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback", allow)).toBe(true);
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback?x=1", allow)).toBe(true);
    expect(isAllowedRedirect("https://claude.ai.evil.com/api/mcp/auth_callback", allow)).toBe(false);
    expect(isAllowedRedirect("https://claude.ai/api/mcp/other", allow)).toBe(false);
    expect(isAllowedRedirect("http://claude.ai/api/mcp/auth_callback", allow)).toBe(false);
    expect(isAllowedRedirect("not a url", allow)).toBe(false);
  });
  it("checks same origin for form posts", () => {
    expect(isSameOrigin("https://jarvis.example", "https://jarvis.example")).toBe(true);
    expect(isSameOrigin("https://evil.example", "https://jarvis.example")).toBe(false);
    expect(isSameOrigin(null, "https://jarvis.example")).toBe(false);
  });
  it("only follows relative next= redirects", () => {
    expect(safeNext("/vault")).toBe("/vault");
    expect(safeNext("/oauth/consent?authorization_id=1")).toBe("/oauth/consent?authorization_id=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });
});
