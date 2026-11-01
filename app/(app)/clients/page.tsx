import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence } from "@/lib/dates";
import { STREAMS, streamLabel } from "@/lib/revenue/streams";
import { listClients } from "@/lib/services/clients";
import { loadRevenue } from "@/lib/services/revenue";
import { ActionForm, InlineAction } from "@/components/forms";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { deleteClientAction, importClientsAction, saveClientAction } from "../actions";

export const dynamic = "force-dynamic";

function ClientFields({ c, contacts }: { c?: Awaited<ReturnType<typeof listClients>>[number]; contacts: { contact_id: string; name: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input name="name" required defaultValue={c?.name} placeholder="Client name" className="input" />
      <select name="xero_contact_id" defaultValue={c?.xero_contact_id ?? ""} className="input"><option value="">Xero contact…</option>{contacts.map((x) => <option key={x.contact_id} value={x.contact_id}>{x.name}</option>)}</select>
      <select name="status" defaultValue={c?.status ?? "active"} className="input"><option value="active">Active</option><option value="prospect">Prospect</option><option value="past">Past</option></select>
      <select name="primary_stream" defaultValue={c?.primary_stream ?? ""} className="input"><option value="">Main stream…</option>{STREAMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      <input name="retainer" defaultValue={c?.retainer_monthly_pence ? (c.retainer_monthly_pence / 100).toFixed(2) : ""} placeholder="Monthly retainer £ (optional)" inputMode="decimal" className="input" />
      <input name="retainer_day" defaultValue={c?.retainer_invoice_day ?? ""} placeholder="Invoice on day (1–28)" inputMode="numeric" className="input" />
      <input name="email" defaultValue={c?.email ?? ""} placeholder="Email" type="email" className="input" />
      <input name="notes" defaultValue={c?.notes ?? ""} placeholder="Notes" className="input" />
    </div>
  );
}

export default async function ClientsPage() {
  const ctx = await dashboardCtx("/clients");
  const [clients, r, { data: contacts }] = await Promise.all([listClients(ctx), loadRevenue(ctx), ctx.sb.from("xero_contacts").select("contact_id, name").eq("owner_id", ctx.ownerId).eq("is_customer", true).order("name")]);
  const revenue = r.hasData ? r.clients("last_12_months").clients : [];
  const byContact = new Map(revenue.map((x) => [x.contactId, x]));

  return (
    <div className="space-y-5">
      <PageHeader label="Clients" title="Clients & retainers" sub="Set monthly retainers so Jarvis can flag any that haven't been invoiced by the grace day.">
        <ActionForm action={importClientsAction} submit="Import from Xero"><span /></ActionForm>
      </PageHeader>
      <Panel title="Add client">
        <ActionForm action={saveClientAction} submit="Add client" resetOnSuccess><ClientFields contacts={contacts ?? []} /></ActionForm>
      </Panel>
      <Panel title={`Clients (${clients.length})`}>
        {clients.length === 0 ? <Empty>No clients yet — import them from Xero or add one above.</Empty> : (
          <ul className="divide-y divide-line">
            {clients.map((c) => {
              const rev = c.xero_contact_id ? byContact.get(c.xero_contact_id) : undefined;
              return (
                <li key={c.id} className="py-3">
                  <details>
                    <summary className="flex cursor-pointer list-none flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        <span className="font-medium">{c.name}</span> <span className="badge ml-1">{c.status}</span>
                        <span className="block text-xs text-muted">{c.primary_stream ? streamLabel(c.primary_stream) : "No stream set"}{c.retainer_monthly_pence ? ` · retainer ${formatGbpFromPence(c.retainer_monthly_pence)}/mo` : ""}{c.xero_contact_id ? "" : " · not linked to Xero"}</span>
                      </span>
                      <span className="font-mono text-sm tabular-nums">{rev ? `${formatGbpFromPence(Math.round(rev.net * 100))} · ${rev.share}%` : "—"}</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <ActionForm action={saveClientAction} submit="Save"><ClientFields c={c} contacts={contacts ?? []} /></ActionForm>
                      <InlineAction action={deleteClientAction} fields={{ id: c.id }} label="Remove client" className="btn btn-ghost btn-sm text-danger" />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
