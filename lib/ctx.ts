import type { SupabaseClient } from "@supabase/supabase-js";
import { mergePrefs, type Prefs } from "@/lib/settings-defaults";

/**
 * Request context shared by every service. `sb` is either the owner's own
 * session/token client (RLS applies) or, for scheduled jobs only, the admin
 * client — so every query filters by `ownerId` explicitly as well.
 */
export type Ctx = {
  sb: SupabaseClient;
  ownerId: string;
  actor: { source: "dashboard" | "mcp" | "system" | "cron"; clientId?: string | null };
};

export async function audit(ctx: Ctx, action: string, target: string | null = null, details: Record<string, unknown> = {}) {
  const { error } = await ctx.sb.from("audit_log").insert({
    owner_id: ctx.ownerId,
    source: ctx.actor.source,
    client_id: ctx.actor.clientId ?? null,
    action,
    target,
    details,
  });
  if (error) throw new Error(`Writing audit log: ${error.message}`);
}

export async function getPrefs(ctx: Ctx): Promise<Prefs> {
  const { data } = await ctx.sb.from("settings").select("prefs").eq("owner_id", ctx.ownerId).maybeSingle();
  return mergePrefs(data?.prefs);
}

export async function savePrefs(ctx: Ctx, patch: Partial<Prefs>): Promise<Prefs> {
  const current = await getPrefs(ctx);
  const next = mergePrefs({ ...current, ...patch });
  const { error } = await ctx.sb.from("settings").upsert({ owner_id: ctx.ownerId, prefs: next }, { onConflict: "owner_id" });
  if (error) throw new Error(`Saving settings: ${error.message}`);
  await audit(ctx, "settings.update", null, { fields: Object.keys(patch) });
  return next;
}

/** Non-sensitive Company Vault values (dates, VAT setup) as a key → value map. */
export async function vaultValues(ctx: Ctx): Promise<Record<string, string>> {
  const { data, error } = await ctx.sb.from("company_fields").select("key, value").eq("owner_id", ctx.ownerId).not("value", "is", null);
  if (error) throw new Error(`Reading company fields: ${error.message}`);
  return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
}

export class UserError extends Error {}

export function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}
