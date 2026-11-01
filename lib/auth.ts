import "server-only";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export type Owner = { id: string; email: string };

/** Pure check used by the proxy, pages and tests. */
export function ownerCheck(claims: { sub?: string; email?: string; aal?: string } | null | undefined, ownerEmail: string):
  | { ok: true; owner: Owner }
  | { ok: false; reason: "signed_out" | "not_owner" | "mfa_required" } {
  if (!claims?.sub) return { ok: false, reason: "signed_out" };
  if ((claims.email ?? "").toLowerCase() !== ownerEmail) return { ok: false, reason: "not_owner" };
  if (claims.aal !== "aal2") return { ok: false, reason: "mfa_required" };
  return { ok: true, owner: { id: claims.sub, email: claims.email! } };
}

/**
 * Data Access Layer guard: every page, server action and route handler that
 * touches data calls this. Requires the owner, signed in with MFA (aal2).
 */
export async function requireOwner(nextPath = "/"): Promise<{ owner: Owner; supabase: Awaited<ReturnType<typeof supabaseServer>> }> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  if (!check.ok) {
    const next = encodeURIComponent(nextPath);
    if (check.reason === "mfa_required") redirect(`/mfa?next=${next}`);
    if (check.reason === "not_owner") {
      await supabase.auth.signOut();
      redirect("/login?error=not_allowed");
    }
    redirect(`/login?next=${next}`);
  }
  return { owner: check.owner, supabase };
}
