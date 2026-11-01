import "server-only";
import { requireOwner } from "@/lib/auth";
import type { Ctx } from "@/lib/ctx";

/** Context for dashboard pages, server actions and route handlers (owner + MFA required). */
export async function dashboardCtx(path = "/"): Promise<Ctx & { owner: { id: string; email: string } }> {
  const { owner, supabase } = await requireOwner(path);
  return { sb: supabase, ownerId: owner.id, actor: { source: "dashboard" }, owner };
}
