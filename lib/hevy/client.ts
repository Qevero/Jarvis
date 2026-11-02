import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit, UserError, type Ctx } from "@/lib/ctx";
import { mapHevyWorkout } from "./map";

/**
 * Hevy public API (api.hevyapp.com/v1). Requires a Hevy Pro account's API key
 * (Hevy → Settings → Developer). The key is stored encrypted.
 */

const BASE = "https://api.hevyapp.com/v1";

async function hevyFetch<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "api-key": apiKey, Accept: "application/json" }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new UserError("Hevy rejected the API key (it needs Hevy Pro; get the key from Hevy → Settings → Developer).");
  if (!res.ok) throw new UserError(`Hevy error ${res.status}.`);
  return (await res.json()) as T;
}

async function apiKey(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.sb.from("integration_connections").select("access_token_enc, status").eq("owner_id", ctx.ownerId).eq("provider", "hevy").maybeSingle();
  if (!data?.access_token_enc || data.status !== "active") return null;
  return decrypt(data.access_token_enc, env.vaultKey());
}

export async function connectHevy(ctx: Ctx, key: string) {
  const k = key.trim();
  if (!/^[A-Za-z0-9-]{16,100}$/.test(k)) throw new UserError("That doesn't look like a Hevy API key.");
  const count = await hevyFetch<{ workout_count?: number }>(k, "/workouts/count");
  const { error } = await ctx.sb.from("integration_connections").upsert(
    { owner_id: ctx.ownerId, provider: "hevy", status: "active", account_label: "Hevy", access_token_enc: encrypt(k, env.vaultKey()), access_expires_at: null, last_error: null },
    { onConflict: "owner_id,provider" },
  );
  if (error) throw new Error(error.message);
  await audit(ctx, "hevy.connect", null, { workouts: count.workout_count ?? null });
  return { workouts: count.workout_count ?? null };
}

/** Pulls recent workouts (newest first) until it reaches ones already stored, or `maxPages`. */
export async function syncHevy(ctx: Ctx, opts: { maxPages?: number } = {}) {
  const key = await apiKey(ctx);
  if (!key) throw new UserError("Hevy isn't connected. Add your Hevy API key in Jarvis → Settings → Personal.");
  const { data: latest } = await ctx.sb.from("workouts").select("updated_at").eq("owner_id", ctx.ownerId).eq("source", "hevy").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const firstRun = !latest;
  let saved = 0;
  for (let page = 1; page <= (opts.maxPages ?? (firstRun ? 30 : 3)); page++) {
    const body = await hevyFetch<{ page_count?: number; workouts?: Record<string, unknown>[] }>(key, `/workouts?page=${page}&pageSize=10`);
    const rows = (body.workouts ?? []).map(mapHevyWorkout).map((r) => ({ ...r, owner_id: ctx.ownerId }));
    if (rows.length) {
      const { error } = await ctx.sb.from("workouts").upsert(rows, { onConflict: "owner_id,source,workout_id" });
      if (error) throw new Error(error.message);
      saved += rows.length;
    }
    if (!body.page_count || page >= body.page_count || rows.length < 10) break;
  }
  await ctx.sb.from("integration_connections").update({ last_error: null, updated_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("provider", "hevy");
  await audit(ctx, "hevy.sync", null, { workouts: saved });
  return { workouts: saved };
}
