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
  await store.appendAudit({ source: "dashboard", action: "data.export_all" });

  const body = {
    exported_at: new Date().toISOString(),
    exported_by: check.owner.email,
    note: "Contains decrypted sensitive fields. Store securely. Document files are not included; download them from the vault.",
    company_fields: fields.map((f) => ({ key: f.key, label: f.label, value: f.value, updated: f.updated })),
    vault_items: items,
    documents,
    audit_log: auditRows ?? [],
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-export-${todayUk()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
