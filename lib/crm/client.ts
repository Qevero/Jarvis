import { env } from "@/lib/env";
import { UserError } from "@/lib/ctx";

/**
 * Read-only connector to Qevero's internal CRM (Qevero/qevero-crm, its own
 * Supabase project). Calls the token-gated, read-only SQL function
 * public.jarvis_crm(...) installed by integrations/qevero-crm/jarvis_connector.sql.
 * Jarvis never writes to the CRM.
 */

export type CrmAction = "overview" | "leads" | "lead" | "tasks" | "tenders" | "search" | "company" | "activity";

export function crmConfigured() {
  return env.crm() !== null;
}

export async function crm<T = Record<string, unknown>>(action: CrmAction, args: Record<string, unknown> = {}): Promise<T> {
  const cfg = env.crm();
  if (!cfg) throw new UserError("The CRM connector isn't set up. See README → Qevero CRM connector.");
  const res = await fetch(`${cfg.url}/rest/v1/rpc/jarvis_crm`, {
    method: "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: cfg.token, p_action: action, p_args: args }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new UserError(`The CRM connector failed: ${msg}`);
  }
  return body as T;
}

export function crmLink(path: string): string | null {
  const app = env.crm()?.appUrl;
  return app ? `${app.replace(/\/$/, "")}${path}` : null;
}
