import "server-only";
import { requireOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { createVaultService } from "./service";
import { supabaseVaultStore } from "./store";

/** Vault service for dashboard pages and server actions (owner + MFA required). */
export async function dashboardVault(path = "/vault") {
  const { owner, supabase } = await requireOwner(path);
  const store = supabaseVaultStore(supabase);
  const vault = createVaultService(store, { key: env.vaultKey(), actor: { source: "dashboard" } });
  return { owner, supabase, store, vault };
}
