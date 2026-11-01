import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { lineTotals, VAT_RATES, type DraftLine } from "@/lib/invoicing/math";
import { getProposal, proposalSummary } from "@/lib/services/proposals";
import { vaultValues } from "@/lib/ctx";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

function Table({ rows, suffix }: { rows: DraftLine[]; suffix?: string }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead><tr className="border-b border-slate-300 text-left text-slate-500"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 text-right font-medium">Qty</th><th className="py-1.5 text-right font-medium">Price</th><th className="py-1.5 text-right font-medium">VAT</th><th className="py-1.5 text-right font-medium">Amount{suffix}</th></tr></thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={i} className="border-b border-slate-200"><td className="py-1.5">{l.description}</td><td className="py-1.5 text-right">{l.quantity}</td><td className="py-1.5 text-right">{formatGbpFromPence(l.unitPricePence)}</td><td className="py-1.5 text-right">{VAT_RATES[l.vat ?? "standard"].label.split(" ")[0]}</td><td className="py-1.5 text-right">{formatGbpFromPence(lineTotals(l).netPence)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}


/** Client-facing proposal, laid out for A4. Use the browser's Print → Save as PDF. */
export default async function PrintProposal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await dashboardCtx(`/print/proposal/${id}`);
  const [p, v] = await Promise.all([getProposal(ctx, id), vaultValues(ctx)]);
  const t = proposalSummary(p);
  const oneOff = p.line_items.filter((l) => l.billing !== "monthly");
  const monthly = p.line_items.filter((l) => l.billing === "monthly");

  return (
    <div className="min-h-dvh bg-white text-slate-900 print:min-h-0">
      <style>{`@page { size: A4; margin: 16mm; } body { background: #fff !important; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print sticky top-0 flex justify-between gap-2 border-b bg-white p-3">
        <a href={`/proposals/${p.id}`} className="rounded-md border px-3 py-2 text-sm">← Back to edit</a>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[180mm] px-6 py-10 font-sans leading-relaxed print:p-0">
        <header className="mb-10 flex items-start justify-between border-b-2 border-slate-900 pb-6">
          <div>
            <p className="text-2xl font-bold tracking-tight">Qevero</p>
            <p className="text-xs text-slate-500">Websites · SEO/GEO · Paid media · Software</p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p className="font-semibold text-slate-900">Proposal {p.number}</p>
            <p>Issued {formatUkDate(p.issue_date)}</p>
            {p.valid_until && <p>Valid until {formatUkDate(p.valid_until)}</p>}
          </div>
        </header>

        <h1 className="mb-1 text-3xl font-bold tracking-tight">{p.title}</h1>
        <p className="mb-8 text-slate-600">Prepared for {p.contact_name ? `${p.contact_name}, ` : ""}{p.client_name}</p>

        {p.intro && <p className="mb-8 whitespace-pre-line">{p.intro}</p>}

        {p.sections.map((s, i) => (
          <section key={i} className="mb-7 break-inside-avoid">
            {s.heading && <h2 className="mb-2 text-lg font-semibold">{s.heading}</h2>}
            <div className="space-y-1">
              {s.body.split("\n").map((line, k) =>
                /^\s*[-•]\s+/.test(line) ? <p key={k} className="pl-4 -indent-3">• {line.replace(/^\s*[-•]\s+/, "")}</p> : line.trim() ? <p key={k}>{line}</p> : <div key={k} className="h-2" />,
              )}
            </div>
          </section>
        ))}

        <section className="mb-8 break-inside-avoid">
          <h2 className="mb-3 text-lg font-semibold">Investment</h2>
          {oneOff.length > 0 && (<><h3 className="mb-1 text-sm font-semibold text-slate-600">One-off</h3><Table rows={oneOff} /></>)}
          {monthly.length > 0 && (<div className="mt-4"><h3 className="mb-1 text-sm font-semibold text-slate-600">Monthly</h3><Table rows={monthly} suffix=" / month" /></div>)}
          <dl className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
            {oneOff.length > 0 && (<><dt className="text-slate-500">One-off (ex VAT)</dt><dd className="text-right">{formatGbpFromPence(t.oneOffNetPence)}</dd></>)}
            {monthly.length > 0 && (<><dt className="text-slate-500">Monthly (ex VAT)</dt><dd className="text-right">{formatGbpFromPence(t.monthlyNetPence)}</dd></>)}
            {t.depositPence > 0 && (<><dt className="text-slate-500">Deposit on acceptance</dt><dd className="text-right">{formatGbpFromPence(t.depositPence)} + VAT</dd></>)}
            <dt className="font-semibold">First-year value</dt><dd className="text-right font-semibold">{formatGbpFromPence(t.firstYearNetPence)} + VAT</dd>
          </dl>
        </section>

        {p.terms && (
          <section className="mb-8 break-inside-avoid">
            <h2 className="mb-2 text-lg font-semibold">Terms</h2>
            <p className="whitespace-pre-line text-xs text-slate-600">{p.terms}</p>
          </section>
        )}

        <section className="break-inside-avoid rounded-lg border border-slate-300 p-5">
          <h2 className="mb-3 font-semibold">Acceptance</h2>
          <p className="mb-6 text-sm">To accept, sign below and return a copy, or reply to the email this came with.</p>
          <div className="grid grid-cols-2 gap-8 text-sm"><p className="border-t border-slate-400 pt-1">Signed for {p.client_name}</p><p className="border-t border-slate-400 pt-1">Date</p></div>
        </section>

        <footer className="mt-10 border-t pt-4 text-[11px] text-slate-500">
          {v.legal_name ?? "Qevero Ltd"} · Company no. {v.company_number ?? "17497612"} · VAT {v.vat_number ?? "GB531607691"}{v.registered_office ? ` · ${v.registered_office}` : ""} · {v.website ?? "qevero.com"}
        </footer>
      </article>
    </div>
  );
}
