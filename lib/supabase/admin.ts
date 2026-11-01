import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client for SCHEDULED JOBS ONLY (app/api/cron/*). It bypasses
 * RLS, so every query it makes must filter by owner_id explicitly. Never use
 * it for anything triggered by a request from a browser or from Claude.
 */
export function supabaseAdmin(): SupabaseClient | null {
  const key = env.supabaseSecretKey();
  if (!key) return null;
  return createClient(env.supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The owner's user id, looked up by JARVIS_OWNER_EMAIL. */
export async function ownerUserId(admin: SupabaseClient): Promise<string | null> {
  const email = env.ownerEmail();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 100) break;
  }
  return null;
}
