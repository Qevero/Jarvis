import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { STREAMS, streamLabel } from "@/lib/revenue/streams";
import { loadRevenue } from "@/lib/services/revenue";
import { trackingCategoryExists } from "@/lib/xero/sync";
import { ActionForm } from "@/components/forms";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { mapAccountAction, overrideLineAction, setupTrackingAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function MappingPage() {
  const ctx = await dashboardCtx("/revenue/mapping");
  const [r, tracking, { data: accounts }] = await Promise.all([loadRevenue(ctx), trackingCategoryExists(ctx), ctx.sb.from("xero_accounts").select("code, name, class").eq("owner_id", ctx.ownerId).eq("class", "REVENUE")]);
  const unmapped = r.unmapped();

  return (
    <div className="space-y-5">
      <PageHeader label="Revenue" title="Stream mapping" sub="How invoice lines are assigned to revenue streams: Xero tracking category first, then account code, then a manual choice per line." />

      <Panel title="1 · Xero tracking category">
        {tracking ? (
          <p className="text-sm">✓ “Revenue Stream” exists in Xero. Pick a stream on each invoice line in Xero (Jarvis does this automatically for invoices it drafts).</p>
        ) : (
          <>
            <p className="mb-2 text-sm">Xero has no “Revenue Stream” tracking category yet. Create it with Qevero&apos;s five streams in one click (or do it in Xero: Accounting → Advanced → Tracking categories).</p>
            <ActionForm action={setupTrackingAction} submit="Create in Xero"><span /></ActionForm>
          </>
        )}
      </Panel>

      <Panel title="2 · Fallback by account code">
        <ActionForm action={mapAccountAction} submit="Save mapping" className="grid gap-3 sm:grid-cols-3">
          <label><span className="hud-label">Account</span>
            <select name="account_code" className="input">{(accounts ?? []).map((a) => <option key={a.code} value={a.code ?? ""}>{a.code} · {a.name}</option>)}{!accounts?.length && <option value="200">200 · Sales</option>}</select>
          </label>
          <label><span className="hud-label">Stream</span>
            <select name="stream" className="input"><option value="">(remove mapping)</option>{STREAMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
        </ActionForm>
        {Object.keys(r.accountMap).length > 0 && (
          <ul className="mt-3 text-sm text-muted">{Object.entries(r.accountMap).map(([code, stream]) => <li key={code}>{code} → {streamLabel(stream)}</li>)}</ul>
        )}
      </Panel>

      <Panel title={`3 · Untagged lines (${unmapped.length})`}>
        {unmapped.length === 0 ? (
          <Empty>Every invoice line has a stream. ✓</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {unmapped.slice(0, 100).map((l) => (
              <li key={l.key} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="text-sm">
                  <p>{l.description || "(no description)"}</p>
                  <p className="text-xs text-muted">{l.contactName} · {l.number} · {formatUkDate(l.date)} · {formatGbpFromPence(Math.round(l.net * 100))} · account {l.accountCode ?? "—"}</p>
                </div>
                <form action={overrideLineAction} className="flex gap-2">
                  <input type="hidden" name="line_key" value={l.key} />
                  <select name="stream" defaultValue={l.suggestion ?? ""} className="input min-h-10 py-0 text-sm" aria-label="Stream">
                    <option value="" disabled>Choose…</option>
                    {STREAMS.map((s) => <option key={s.id} value={s.id}>{s.label}{l.suggestion === s.id ? " (suggested)" : ""}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm">Set</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
