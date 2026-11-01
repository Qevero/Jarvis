import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authServerUrl, env } from "@/lib/env";
import { extractBearer, unauthorizedResponse, verifyAccessToken, type TokenClaims } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { supabaseAnon, supabaseWithToken } from "@/lib/supabase/server";
import { supabaseVaultStore } from "@/lib/vault/store";
import { createVaultService } from "@/lib/vault/service";

/**
 * Jarvis MCP endpoint (Streamable HTTP, stateless, JSON responses).
 * Add https://<your-site>/api/mcp in Claude → Settings → Connectors.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function getClaims(token: string): Promise<TokenClaims | null> {
  const { data, error } = await supabaseAnon().auth.getClaims(token);
  if (error || !data) return null;
  return data.claims as TokenClaims;
}

async function handle(request: Request): Promise<Response> {
  const siteUrl = env.siteUrl();
  const token = extractBearer(request.headers.get("authorization"));
  if (!token) return withCors(unauthorizedResponse(siteUrl));

  const verified = await verifyAccessToken(token, { getClaims, issuer: authServerUrl(), ownerEmail: env.ownerEmail() });
  if (!verified.ok) return withCors(unauthorizedResponse(siteUrl, verified.description, verified.error));

  const supabase = supabaseWithToken(token);
  const actor = { source: "mcp" as const, clientId: verified.auth.clientId };
  const vault = createVaultService(supabaseVaultStore(supabase), { key: env.vaultKey(), actor });
  const ctx = { sb: supabase, ownerId: String(verified.auth.extra?.userId), actor };

  const server = buildMcpServer({ ctx, vault });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request, { authInfo: verified.auth }));
  } finally {
    // Stateless: tear down after each request.
    void transport.close();
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
