import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie and keeps signed-out visitors on the
 * login page. Pages still call requireOwner() (lib/auth.ts) for the full
 * owner + MFA check; this is the first line of defence.
 */

const PUBLIC_PATHS = ["/login", "/offline"];
const SESSION_ONLY_PATHS = ["/mfa", "/auth/signout"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const sessionOnly = SESSION_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  const redirectTo = (target: string) => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!claims && !isPublic) return redirectTo("/login");
  if (claims && !isPublic && !sessionOnly && claims.aal !== "aal2") return redirectTo("/mfa");

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the PWA files, the MCP endpoint (which
    // uses OAuth bearer tokens) and the OAuth discovery metadata.
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|offline.html|api/mcp|api/oauth-protected-resource|api/cron/|api/ingest/|\\.well-known/).*)",
  ],
};
