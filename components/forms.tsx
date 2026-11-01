"use client";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STREAMS } from "@/lib/revenue/streams";
import { VAT_CODES, VAT_RATES, documentTotals, type DraftLine } from "@/lib/invoicing/math";

export type ActionState = { ok: boolean; message: string; href?: string } | null;

/** Generic form bound to a server action returning { ok, message }. */
export function ActionForm({ action, children, submit, className = "", resetOnSuccess = false, confirmText }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState>; children: React.ReactNode; submit: string; className?: string; resetOnSuccess?: boolean; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    return r;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "Working…" : submit}</button>
        {state && (
          <span className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>
            {state.message}
            {state.href && <a href={state.href} target={state.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="ml-2 text-accent underline">Open</a>}
          </span>
        )}
      </div>
    </form>
  );
}

/** Small inline button form (e.g. "Mark done") — no message area. */
export function InlineAction({ action, fields, label, className = "btn btn-ghost btn-sm" }: { action: (fd: FormData) => Promise<void>; fields: Record<string, string>; label: string; className?: string }) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={className}>{label}</button>
    </form>
  );
}

const gbp = (p: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p / 100);

/** Line-item editor; serialises lines to a hidden "lines" JSON field (prices in pence). */
export function LineEditor({ initial = [], mode }: { initial?: DraftLine[]; mode: "sales" | "purchase" | "proposal" }) {
  const blank: DraftLine = { description: "", quantity: 1, unitPricePence: 0, vat: "standard", stream: mode === "purchase" ? null : "website_builds", billing: "one-off" };
  const [lines, setLines] = useState<DraftLine[]>(initial.length ? initial : [blank]);
  const set = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const valid = lines.filter((l) => l.description.trim());
  const t = documentTotals(valid);
  return (
    <div className="space-y-3">
      <input type="hidden" name="lines" value={JSON.stringify(valid)} />
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
          <input aria-label="Description" placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="input sm:col-span-12" />
          <label className="sm:col-span-2"><span className="hud-label">Qty</span><input inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) || 0 })} className="input" /></label>
          <label className="sm:col-span-3"><span className="hud-label">Unit £ (ex VAT)</span><input inputMode="decimal" defaultValue={l.unitPricePence ? (l.unitPricePence / 100).toFixed(2) : ""} onChange={(e) => set(i, { unitPricePence: Math.round((Number(e.target.value.replace(/[£,]/g, "")) || 0) * 100) })} className="input" /></label>
          <label className="sm:col-span-3"><span className="hud-label">VAT</span>
            <select value={l.vat} onChange={(e) => set(i, { vat: e.target.value as DraftLine["vat"] })} className="input">{VAT_CODES.map((c) => <option key={c} value={c}>{VAT_RATES[c].label}</option>)}</select>
          </label>
          {mode !== "purchase" ? (
            <label className="sm:col-span-4"><span className="hud-label">Stream</span>
              <select value={l.stream ?? ""} onChange={(e) => set(i, { stream: e.target.value || null })} className="input"><option value="">—</option>{STREAMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
          ) : (
            <label className="sm:col-span-4"><span className="hud-label">Account code</span><input value={l.accountCode ?? ""} onChange={(e) => set(i, { accountCode: e.target.value || null })} placeholder="Default" className="input" /></label>
          )}
          {mode === "proposal" && (
            <label className="sm:col-span-4"><span className="hud-label">Billing</span>
              <select value={l.billing} onChange={(e) => set(i, { billing: e.target.value as DraftLine["billing"] })} className="input"><option value="one-off">One-off</option><option value="monthly">Monthly</option></select>
            </label>
          )}
          <div className="flex items-end justify-between gap-2 sm:col-span-12">
            <span className="font-mono text-sm tabular-nums text-muted">{gbp(Math.round(l.quantity * l.unitPricePence))}</span>
            {lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="text-xs text-muted hover:text-danger">Remove line</button>}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setLines((ls) => [...ls, blank])} className="btn btn-ghost btn-sm">+ Add line</button>
      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-1 font-mono text-sm tabular-nums">
        <dt className="font-sans text-muted">Net</dt><dd className="text-right">{gbp(t.netPence)}</dd>
        <dt className="font-sans text-muted">VAT</dt><dd className="text-right">{gbp(t.vatPence)}</dd>
        <dt className="font-sans font-semibold">Total</dt><dd className="text-right font-semibold">{gbp(t.grossPence)}</dd>
        {mode === "proposal" && t.monthlyNetPence > 0 && (<><dt className="font-sans text-muted">Monthly</dt><dd className="text-right">{gbp(t.monthlyNetPence)}/mo</dd></>)}
      </dl>
    </div>
  );
}

const noopSubscribe = () => () => {};
/** A browser-only check (e.g. feature detection) that renders false on the server. */
export function useBrowserCheck(check: () => boolean): boolean {
  return useSyncExternalStore(noopSubscribe, check, () => false);
}
