import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { getProposal, proposalSummary, PROPOSAL_STATUSES } from "@/lib/services/proposals";
import { ActionForm, InlineAction, LineEditor } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";
import { SectionsEditor } from "./sections-editor";
import { deleteProposalAction, proposalInvoiceAction, proposalQuoteAction, proposalStatusAction, saveProposalAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await dashboardCtx(`/proposals/${id}`);
  const p = await getProposal(ctx, id);
  const t = proposalSummary(p);

  return (
    <div className="space-y-5">
      <PageHeader label={`Proposal ${p.number}`} title={p.title} sub={`${p.client_name} · ${p.status} · ${t.text}`}>
        <Link href={`/print/proposal/${p.id}`} target="_blank" className="btn btn-ghost btn-sm">Print / PDF</Link>
        <Link href="/proposals" className="btn btn-ghost btn-sm">All proposals</Link>
      </PageHeader>

      <Panel title="Status">
        <div className="flex flex-wrap gap-2">
          {PROPOSAL_STATUSES.map((s) => (
            <InlineAction key={s} action={proposalStatusAction} fields={{ id: p.id, status: s }} label={s[0].toUpperCase() + s.slice(1)} className={`btn btn-sm ${p.status === s ? "btn-primary" : "btn-ghost"}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Jarvis never sends proposals. Print to PDF and send it yourself, then mark it Sent so Jarvis can remind you to follow up.{p.sent_at && ` Sent ${formatUkDate(p.sent_at)}.`}</p>
      </Panel>

      <ActionForm action={saveProposalAction} submit="Save proposal" className="space-y-5">
        <input type="hidden" name="id" value={p.id} />
        <Panel title="Details">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="hud-label">Title</span><input name="title" defaultValue={p.title} className="input" /></label>
            <label><span className="hud-label">Client</span><input name="client_name" defaultValue={p.client_name} className="input" /></label>
            <label><span className="hud-label">Valid until</span><input name="valid_until" defaultValue={formatUkDate(p.valid_until)} className="input" /></label>
            <label><span className="hud-label">Contact name</span><input name="contact_name" defaultValue={p.contact_name ?? ""} className="input" /></label>
            <label><span className="hud-label">Contact email</span><input name="contact_email" type="email" defaultValue={p.contact_email ?? ""} className="input" /></label>
            <label className="sm:col-span-2"><span className="hud-label">Introduction</span><textarea name="intro" defaultValue={p.intro ?? ""} rows={3} className="input" /></label>
          </div>
        </Panel>
        <Panel title="Sections">
          <SectionsEditor initial={p.sections} />
        </Panel>
        <Panel title="Pricing">
          <LineEditor mode="proposal" initial={p.line_items} />
          <label className="mt-3 block max-w-xs"><span className="hud-label">Deposit on one-off fees (%)</span><input name="deposit_percent" type="number" min={0} max={100} defaultValue={p.deposit_percent ?? 0} className="input" /></label>
        </Panel>
        <Panel title="Terms">
          <textarea name="terms" defaultValue={p.terms ?? ""} rows={7} className="input font-mono text-sm" />
        </Panel>
      </ActionForm>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Xero quote">
          {p.xero_quote_id ? <p className="text-sm">Draft quote {p.xero_quote_number} created in Xero.</p> : <p className="mb-2 text-sm text-muted">Mirror this pricing into a DRAFT quote in Xero.</p>}
          <ActionForm action={proposalQuoteAction} submit={p.xero_quote_id ? "Create another quote" : "Create Xero quote"} confirmText="Create a DRAFT quote in Xero from this proposal?">
            <input type="hidden" name="id" value={p.id} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="create_contact" className="h-5 w-5" /> Create the Xero contact if missing</label>
          </ActionForm>
        </Panel>
        <Panel title="Invoice it">
          <p className="mb-2 text-sm text-muted">Deposit {formatGbpFromPence(t.depositPence)} · one-off {formatGbpFromPence(t.oneOffNetPence)} · monthly {formatGbpFromPence(t.monthlyNetPence)} (ex VAT)</p>
          <ActionForm action={proposalInvoiceAction} submit="Create draft invoice" confirmText="Create a DRAFT invoice in Xero and mark this proposal accepted?">
            <input type="hidden" name="id" value={p.id} />
            <select name="which" defaultValue={p.deposit_percent ? "deposit" : "full"} className="input">
              <option value="deposit">Deposit ({p.deposit_percent ?? 0}%)</option>
              <option value="full">Full one-off fees</option>
              <option value="monthly">First month of monthly fees</option>
            </select>
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="create_contact" className="h-5 w-5" /> Create the Xero contact if missing</label>
          </ActionForm>
        </Panel>
      </div>

      <InlineAction action={deleteProposalAction} fields={{ id: p.id }} label="Delete proposal" className="btn btn-ghost btn-sm text-danger" />
    </div>
  );
}
