import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * MCP authorisation (resource server side). Claude obtains an access token
 * from Supabase Auth's OAuth 2.1 server; we verify it on every request.
 *
 * A token is accepted only if:
 *  - its signature and expiry verify (via Supabase getClaims / JWKS),
 *  - it was issued by this project's Auth server,
 *  - it is an OAuth client token (has client_id), not a dashboard session,
 *  - it belongs to the owner's email.
 */

export type TokenClaims = {
  sub?: string;
  email?: string;
  iss?: string;
  exp?: number;
  client_id?: string;
  scope?: string;
  aal?: string;
  role?: string;
};

export type VerifyDeps = {
  getClaims: (token: string) => Promise<TokenClaims | null>;
  issuer: string;
  ownerEmail: string;
  now?: () => number;
};

export type VerifyResult = { ok: true; auth: AuthInfo } | { ok: false; error: "invalid_token"; description: string };

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export async function verifyAccessToken(token: string, deps: VerifyDeps): Promise<VerifyResult> {
  const bad = (description: string): VerifyResult => ({ ok: false, error: "invalid_token", description });
  let claims: TokenClaims | null;
  try {
    claims = await deps.getClaims(token);
  } catch {
    return bad("Token could not be verified.");
  }
  if (!claims?.sub) return bad("Token could not be verified.");
  const nowSec = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) return bad("Token has expired.");
  if (claims.iss !== deps.issuer) return bad("Token was not issued by Jarvis's authorisation server.");
  if (!claims.client_id) return bad("Token is not an OAuth connector token.");
  if (claims.role !== "authenticated") return bad("Token has the wrong role.");
  if ((claims.email ?? "").toLowerCase() !== deps.ownerEmail) return bad("This account is not allowed to use Jarvis.");

  return {
    ok: true,
    auth: {
      token,
      clientId: claims.client_id,
      scopes: claims.scope ? claims.scope.split(" ").filter(Boolean) : [],
      expiresAt: claims.exp,
      extra: { userId: claims.sub, aal: claims.aal ?? null },
    },
  };
}

/** RFC 9728 Protected Resource Metadata for the Jarvis MCP endpoint. */
export function protectedResourceMetadata(resource: string, authorizationServer: string) {
  return {
    resource,
    authorization_servers: [authorizationServer],
    bearer_methods_supported: ["header"],
    resource_name: "Jarvis (Qevero)",
    resource_documentation: resource.replace(/\/api\/mcp$/, "/settings"),
  };
}

export function resourceMetadataUrl(siteUrl: string): string {
  return `${siteUrl}/.well-known/oauth-protected-resource/api/mcp`;
}

/** 401 response that tells MCP clients where to start the OAuth flow. */
export function unauthorizedResponse(siteUrl: string, description = "Authorisation required.", error?: string): Response {
  const parts = [`resource_metadata="${resourceMetadataUrl(siteUrl)}"`];
  if (error) parts.push(`error="${error}"`, `error_description="${description.replace(/"/g, "'")}"`);
  return new Response(JSON.stringify({ error: error ?? "unauthorized", error_description: description }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer ${parts.join(", ")}`,
      "Cache-Control": "no-store",
    },
  });
}
