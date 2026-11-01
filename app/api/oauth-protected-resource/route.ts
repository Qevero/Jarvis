import { authServerUrl, mcpResourceUrl } from "@/lib/env";
import { protectedResourceMetadata } from "@/lib/mcp/auth";

/** Served at /.well-known/oauth-protected-resource[/api/mcp] via a rewrite. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(protectedResourceMetadata(mcpResourceUrl(), authServerUrl()), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}
