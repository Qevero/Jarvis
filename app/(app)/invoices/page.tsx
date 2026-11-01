import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate, todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { connectionStatus } from "@/lib/integrations/connections";
import { getPrefs } from "@/lib/ctx";
import { listQuotesAndPOs } from "@/lib/xero/actions";
import { xeroDate } from "@/lib/xero/map";
import { ActionForm, LineEditor } from "@/components/forms";
import { ConnectPrompt, Empty, PageHeader, Panel, Tabs } from "@/components/ui";
import { createInvoiceAction, createPurchaseOrderAction, createQuoteAction } from "../actions";

export const dynamic = "force-dynamic";

const gbp = (n: number) => formatGbpFromPence(Math.round(Number(n) * 100));

type Inv = { invoice_id: string; number: string | null; contact_name: string | null; status: string; date: string | null; due_date: string | null; total: number; amount_due: number; type: string };

function InvoiceTable({ rows, today, pdf }: { rows: Inv[]; today: string; pdf?: boolean }) {
  if (!rows.length) return <Empty>Nothing here.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted"><th className="py-1.5 font-normal">Number</th><th className="py-1.5 font-normal">Contact</th><th className="py-1.5 font-normal">Date</th><th className="py-1.5 font-normal">Due</th><th className="py-1.5 text-right font-normal">Total</th><th className="py-1.5 text-right font-normal">Owed</th><th className="py-1.5 font-normal" /></tr></thead>
        <tbody>
          {rows.map((i) => {
            const overdue = i.status === "AUTHORISED" && i.amount_due > 0 && i.due_date && i.due_date < today;
            return (
              <tr key={i.invoice_id} className="border-t border-line">
                <td className="py-2">{i.number ?? <span className="badge">{i.status.toLowerCase()}</span>}</td>
                <td className="py-2">{i.contact_name}</td>
                <td className="py-2 font-mono tabular-nums">{formatUkDate(i.date)}</td>
                <td className={`py-2 font-mono tabular-nums ${overdue ? "text-danger" : ""}`}>{formatUkDate(i.due_date)}{overdue && " · overdue"}</td>
                <td className="py-2 text-right font-mono tabular-nums">{gbp(i.total)}</td>
                <td className="py-2 text-right font-mono tabular-nums">{i.amount_due > 0 ? gbp(i.amount_due) : "—"}</td>
                <td className="py-2 text-right">{pdf && i.status !== "DRAFT" && <a href={`/api/xero/invoice-pdf/${i.invoice_id}`} target="_blank" rel="noreferrer" className="text-xs text-accent">PDF</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContactFields({ placeholder }: { placeholder: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label><span className="hud-label">{placeholder}</span><input name="contact" required list="xero-contacts" className="input" autoComplete="off" /></label>
      <label><span className="hud-label">Email (new contacts)</span><input name="email" type="email" className="input" /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="create_contact" className="h-5 w-5" /> Create the contact in Xero if it doesn&apos;t exist</label>
    </div>
  );
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await dashboardCtx("/invoices");
  const { tab = "sales" } = await searchParams;
  const today = todayUk();
  const xero = await connectionStatus(ctx, "xero");
  const tabs = [
    { id: "sales", label: "Sales", href: "/invoices?tab=sales" },
    { id: "bills", label: "Bills", href: "/invoices?tab=bills" },
    { id: "new", label: "New invoice", href: "/invoices?tab=new" },
    { id: "quote", label: "New quote", href: "/invoices?tab=quote" },
    { id: "po", label: "New purchase order", href: "/invoices?tab=po" },
    { id: "xero", label: "Quotes & POs", href: "/invoices?tab=xero" },
  ];

  const header = <PageHeader label="Invoicing" title="Invoices, quotes & purchase orders" sub="Jarvis creates everything as a DRAFT in Xero — you approve and send it there. Standard rate VAT (20%) by default." />;
  if (xero?.status !== "active") return (<div>{header}<ConnectPrompt what="Xero" /></div>);

  const prefs = await getPrefs(ctx);
  const { data: contacts } = await ctx.sb.from("xero_contacts").select("name, is_customer, is_supplier").eq("owner_id", ctx.ownerId).order("name").limit(1000);
  const contactList = (contacts ?? []).filter((c) => (tab === "po" ? c.is_supplier || !c.is_customer : c.is_customer || !c.is_supplier));

  let body: React.ReactNode = null;
  if (tab === "sales" || tab === "bills") {
    const type = tab === "sales" ? "ACCREC" : "ACCPAY";
    const { data } = await ctx.sb.from("xero_invoices").select("invoice_id, number, contact_name, status, date, due_date, total, amount_due, type").eq("owner_id", ctx.ownerId).eq("type", type).neq("status", "DELETED").neq("status", "VOIDED").order("date", { ascending: false }).limit(300);
    const rows = (data ?? []) as Inv[];
    const unpaid = rows.filter((i) => i.status === "AUTHORISED" && i.amount_due > 0);
    const drafts = rows.filter((i) => i.status === "DRAFT" || i.status === "SUBMITTED");
    const paid = rows.filter((i) => i.status === "PAID").slice(0, 25);
    body = (
      <div className="space-y-5">
        <Panel title={`Unpaid (${unpaid.length}) · ${gbp(unpaid.reduce((a, i) => a + Number(i.amount_due), 0))}`}><InvoiceTable rows={unpaid} today={today} pdf /></Panel>
        <Panel title={`Drafts (${drafts.length})`}><InvoiceTable rows={drafts} today={today} /></Panel>
        <Panel title="Recently paid"><InvoiceTable rows={paid} today={today} pdf /></Panel>
      </div>
    );
  } else if (tab === "new") {
    body = (
      <Panel title="New sales invoice (draft)">
        <ActionForm action={createInvoiceAction} submit="Create draft in Xero" confirmText="Create this invoice as a DRAFT in Xero?">
          <div className="space-y-4">
            <ContactFields placeholder="Customer" />
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="hud-label">Invoice date</span><input name="date" defaultValue={formatUkDate(today)} className="input" /></label>
              <label><span className="hud-label">Due date</span><input name="due_date" defaultValue={formatUkDate(addDays(today, prefs.paymentTermsDays))} className="input" /></label>
              <label><span className="hud-label">Reference</span><input name="reference" className="input" /></label>
            </div>
            <LineEditor mode="sales" />
          </div>
        </ActionForm>
      </Panel>
    );
  } else if (tab === "quote") {
    body = (
      <Panel title="New quote (draft)">
        <p className="mb-3 text-sm text-muted">For a full written proposal with scope and terms, use Proposals — it can create the Xero quote for you.</p>
        <ActionForm action={createQuoteAction} submit="Create draft quote in Xero" confirmText="Create this quote as a DRAFT in Xero?">
          <div className="space-y-4">
            <ContactFields placeholder="Customer" />
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="hud-label">Title</span><input name="title" className="input" /></label>
              <label><span className="hud-label">Expires</span><input name="expiry_date" defaultValue={formatUkDate(addDays(today, 30))} className="input" /></label>
              <label><span className="hud-label">Reference</span><input name="reference" className="input" /></label>
            </div>
            <LineEditor mode="sales" />
          </div>
        </ActionForm>
      </Panel>
    );
  } else if (tab === "po") {
    body = (
      <Panel title="New purchase order (draft)">
        <ActionForm action={createPurchaseOrderAction} submit="Create draft PO in Xero" confirmText="Create this purchase order as a DRAFT in Xero?">
          <div className="space-y-4">
            <ContactFields placeholder="Supplier" />
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="hud-label">Delivery date</span><input name="delivery_date" placeholder="DD/MM/YYYY" className="input" /></label>
              <label><span className="hud-label">Reference</span><input name="reference" className="input" /></label>
              <label><span className="hud-label">Delivery instructions</span><input name="instructions" className="input" /></label>
            </div>
            <LineEditor mode="purchase" initial={[{ description: "", quantity: 1, unitPricePence: 0, vat: "standard", accountCode: prefs.defaultPurchaseAccount }]} />
          </div>
        </ActionForm>
      </Panel>
    );
  } else {
    const live = await listQuotesAndPOs(ctx).catch((e: Error) => ({ error: e.message }));
    body = "error" in live ? (
      <Empty>{live.error}</Empty>
    ) : (
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Quotes (from Xero)">
          <ul className="divide-y divide-line text-sm">{live.quotes.length ? live.quotes.map((q) => <li key={String(q.id)} className="flex justify-between gap-3 py-2"><span>{String(q.number ?? "")} · {String(q.contact ?? "")}<span className="badge ml-2">{String(q.status).toLowerCase()}</span></span><span className="font-mono tabular-nums">{gbp(Number(q.total))} · {formatUkDate(xeroDate(q.date))}</span></li>) : <li className="py-2 text-muted">No quotes.</li>}</ul>
        </Panel>
        <Panel title="Purchase orders (from Xero)">
          <ul className="divide-y divide-line text-sm">{live.purchaseOrders.length ? live.purchaseOrders.map((p) => <li key={String(p.id)} className="flex justify-between gap-3 py-2"><span>{String(p.number ?? "")} · {String(p.contact ?? "")}<span className="badge ml-2">{String(p.status).toLowerCase()}</span></span><span className="font-mono tabular-nums">{gbp(Number(p.total))} · {formatUkDate(xeroDate(p.date))}</span></li>) : <li className="py-2 text-muted">No purchase orders.</li>}</ul>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Tabs tabs={tabs} active={tab} />
      <datalist id="xero-contacts">{contactList.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      {body}
    </div>
  );
}
