import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { connectionStatus } from "@/lib/integrations/connections";
import { getJournalEntry } from "@/lib/services/journal";
import { ActionForm, InlineAction } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";
import { SpeakButton } from "@/components/voice";
import { deleteJournalAction, pushActionToTodoAction, saveJournalAction } from "../../actions";

export const dynamic = "force-dynamic";

function List({ title, items }: { title: string; items: string[] }) {
  return items.length ? (
    <Panel title={title}><ul className="list-disc space-y-1 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></Panel>
  ) : null;
}

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await dashboardCtx(`/journal/${id}`);
  const [e, ms] = await Promise.all([getJournalEntry(ctx, id), connectionStatus(ctx, "microsoft")]);

  return (
    <div className="space-y-5">
      <PageHeader label={`Journal · ${formatUkDate(e.entry_date)}`} title={e.title}>
        <SpeakButton text={[e.title, e.summary, ...e.decisions.map((d) => `Decision: ${d}`)].filter(Boolean).join(". ")} label="Listen" />
        <a href={`/api/journal/${e.id}/blog`} className="btn btn-ghost btn-sm">Blog draft (.md)</a>
        <Link href="/journal" className="btn btn-ghost btn-sm">All entries</Link>
      </PageHeader>
      <div className="flex flex-wrap gap-1">
        {e.themes.map((t) => <Link key={t} href={`/journal?theme=${encodeURIComponent(t)}`} className="badge">{t}</Link>)}
        {e.linked_clients.map((c) => <Link key={c} href={`/journal?client=${encodeURIComponent(c)}`} className="badge border-accent/50 text-accent">{c}</Link>)}
      </div>
      {e.summary && <Panel title="Summary"><p className="text-sm leading-relaxed">{e.summary}</p></Panel>}
      <div className="grid gap-5 lg:grid-cols-2">
        <List title="Decisions" items={e.decisions} />
        <List title="Ideas" items={e.ideas} />
      </div>
      {e.action_items.length > 0 && (
        <Panel title="Action items">
          <ul className="divide-y divide-line">
            {e.action_items.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{a.text}{a.due && <span className="text-muted"> · {formatUkDate(a.due)}</span>}</span>
                {a.pushed_task_id ? <span className="badge border-ok/50 text-ok">In To Do</span> : ms?.status === "active" ? <InlineAction action={pushActionToTodoAction} fields={{ id: e.id, index: String(i) }} label="→ To Do" /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {e.raw_notes && <Panel title="Raw notes"><p className="whitespace-pre-wrap text-sm text-muted">{e.raw_notes}</p></Panel>}
      <Panel title="Edit">
        <details>
          <summary className="cursor-pointer text-sm text-accent">Edit this entry</summary>
          <ActionForm action={saveJournalAction} submit="Save" className="mt-3 space-y-2">
            <input type="hidden" name="id" value={e.id} />
            <input name="title" defaultValue={e.title} className="input" />
            <input name="entry_date" defaultValue={formatUkDate(e.entry_date)} className="input" />
            <textarea name="summary" defaultValue={e.summary ?? ""} rows={3} className="input" />
            <textarea name="raw_notes" defaultValue={e.raw_notes ?? ""} rows={5} className="input" />
            <input name="themes" defaultValue={e.themes.join(", ")} className="input" />
            <textarea name="decisions" defaultValue={e.decisions.join("\n")} rows={3} className="input" />
            <textarea name="ideas" defaultValue={e.ideas.join("\n")} rows={3} className="input" />
            <textarea name="action_items" defaultValue={e.action_items.map((a) => a.text).join("\n")} rows={3} className="input" />
            <input name="linked_clients" defaultValue={e.linked_clients.join(", ")} className="input" />
          </ActionForm>
        </details>
      </Panel>
      <InlineAction action={deleteJournalAction} fields={{ id: e.id }} label="Delete entry" className="btn btn-ghost btn-sm text-danger" />
    </div>
  );
}
