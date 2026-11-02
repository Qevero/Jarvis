import { NextResponse } from "next/server";
import { ownerCheck } from "@/lib/auth";
import { env } from "@/lib/env";
import { todayUk } from "@/lib/dates";
import { supabaseServer } from "@/lib/supabase/server";
import { createVaultService } from "@/lib/vault/service";
import { supabaseVaultStore } from "@/lib/vault/store";

export const dynamic = "force-dynamic";

/** UK GDPR export: everything Jarvis stores, as one JSON file. */
export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const check = ownerCheck(data?.claims as never, env.ownerEmail());
  if (!check.ok) return NextResponse.json({ error: "Sign in with MFA first." }, { status: 401 });

  const store = supabaseVaultStore(supabase);
  const vault = createVaultService(store, { key: env.vaultKey(), actor: { source: "dashboard" } });

  const [fields, items, documents] = await Promise.all([vault.getProfile({ reveal: true }), store.listItems(), store.listDocuments()]);
  const { data: auditRows } = await supabase.from("audit_log").select("*").order("occurred_at", { ascending: true });
  const tables = ["settings", "journal_entries", "knowledge_items", "chat_conversations", "chat_messages", "clients", "proposals", "stream_account_map", "stream_line_overrides", "deadline_status", "tax_rule_verifications", "xero_documents", "xero_contacts", "xero_invoices", "xero_invoice_lines", "xero_bank_transactions", "health_daily", "workouts"];
  const extra: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase.from(t).select(t === "chat_messages" ? "conversation_id, position, sender, sent_at, body" : "*").range(from, from + 999);
      rows.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    extra[t] = rows;
  }
  await store.appendAudit({ source: "dashboard", action: "data.export_all" });

  const body = {
    exported_at: new Date().toISOString(),
    exported_by: check.owner.email,
    note: "Contains decrypted sensitive fields. Store securely. Document files are not included; download them from the vault.",
    company_fields: fields.map((f) => ({ key: f.key, label: f.label, value: f.value, updated: f.updated })),
    vault_items: items,
    documents,
    audit_log: auditRows ?? [],
    ...extra,
    note_integrations: "Xero, Microsoft and Hevy credentials and device tokens are deliberately excluded. Forwarded messages are excluded (they are temporary and auto-deleted).",
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-export-${todayUk()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
