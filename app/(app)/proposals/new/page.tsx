import { dashboardCtx } from "@/lib/dashboard-ctx";
import { TEMPLATES } from "@/lib/proposals/templates";
import { ActionForm } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";
import { createProposalAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewProposalPage() {
  const ctx = await dashboardCtx("/proposals/new");
  const { data: clients } = await ctx.sb.from("clients").select("name").eq("owner_id", ctx.ownerId).order("name");
  return (
    <div>
      <PageHeader label="Proposals" title="New proposal" />
      <Panel>
        <ActionForm action={createProposalAction} submit="Create and edit">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="hud-label">Title</span><input name="title" required placeholder="e.g. New website and SEO foundations" className="input" /></label>
            <label><span className="hud-label">Client</span><input name="client_name" required list="clients" className="input" /></label>
            <label><span className="hud-label">Template</span>
              <select name="template" className="input">{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label><span className="hud-label">Contact name</span><input name="contact_name" className="input" /></label>
            <label><span className="hud-label">Contact email</span><input name="contact_email" type="email" className="input" /></label>
          </div>
          <datalist id="clients">{(clients ?? []).map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </ActionForm>
      </Panel>
    </div>
  );
}
