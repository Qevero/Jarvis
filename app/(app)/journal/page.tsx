import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { allThemesAndClients, journalThemes, searchJournal } from "@/lib/services/journal";
import { ActionForm } from "@/components/forms";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { QuickNote } from "@/components/voice";
import { saveJournalAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ q?: string; theme?: string; client?: string }> }) {
  const ctx = await dashboardCtx("/journal");
  const sp = await searchParams;
  const [entries, facets, themes] = await Promise.all([searchJournal(ctx, { query: sp.q, theme: sp.theme, client: sp.client, limit: 60 }), allThemesAndClients(ctx), journalThemes(ctx, 6)]);
  const filtered = Boolean(sp.q || sp.theme || sp.client);

  return (
    <div className="space-y-5">
      <PageHeader label="Thought journal" title="Journal" sub="Talk it through in Claude (“Jarvis, save this to my journal”) and it lands here, structured." />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <form className="flex gap-2" role="search">
            <input name="q" defaultValue={sp.q} placeholder="Search the journal…" className="input" />
            {sp.theme && <input type="hidden" name="theme" value={sp.theme} />}
            <button className="btn btn-ghost">Search</button>
          </form>
          {filtered && (
            <p className="text-sm text-muted">
              Showing {sp.q && <>“{sp.q}” </>}{sp.theme && <>theme <b>{sp.theme}</b> </>}{sp.client && <>client <b>{sp.client}</b> </>}· <Link href="/journal" className="text-accent">clear</Link>
            </p>
          )}
          {entries.length === 0 ? (
            <Empty>{filtered ? "No matching entries." : "No entries yet. Try a quick note, or tell Claude what's on your mind."}</Empty>
          ) : (
            <ol className="relative space-y-3 border-l border-line pl-5">
              {entries.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full bg-accent" />
                  <Link href={`/journal/${e.id}`} className="panel block p-4 hover:border-[var(--line-strong)]">
                    <p className="hud-label">{formatUkDate(e.entry_date)}{e.source === "voice" ? " · voice note" : e.source === "claude" ? " · via Claude" : ""}</p>
                    <p className="mt-1 font-medium">{e.title}</p>
                    {e.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{e.summary}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {e.themes.map((t) => <span key={t} className="badge">{t}</span>)}
                      {e.linked_clients.map((c) => <span key={c} className="badge border-accent/50 text-accent">{c}</span>)}
                      {e.action_items.length > 0 && <span className="badge">{e.action_items.length} action{e.action_items.length > 1 ? "s" : ""}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title="Quick note"><QuickNote /></Panel>
          <Panel title="Themes">
            {facets.themes.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <div className="flex flex-wrap gap-1.5">{facets.themes.slice(0, 30).map((t) => <Link key={t} href={`/journal?theme=${encodeURIComponent(t)}`} className={`badge min-h-8 ${sp.theme === t ? "border-accent text-accent" : ""}`}>{t}</Link>)}</div>
            )}
            {themes.themes.length > 0 && (
              <p className="mt-3 text-xs text-muted">Last 6 months: {themes.themes.slice(0, 5).map((t) => `${t.theme} (${t.total})`).join(", ")}</p>
            )}
          </Panel>
          {facets.clients.length > 0 && (
            <Panel title="Clients">
              <div className="flex flex-wrap gap-1.5">{facets.clients.slice(0, 30).map((c) => <Link key={c} href={`/journal?client=${encodeURIComponent(c)}`} className="badge min-h-8">{c}</Link>)}</div>
            </Panel>
          )}
          <Panel title="Full entry">
            <details>
              <summary className="cursor-pointer text-sm text-accent">Write a structured entry</summary>
              <ActionForm action={saveJournalAction} submit="Save entry" className="mt-3 space-y-2">
                <input name="title" required placeholder="Title" className="input" />
                <textarea name="summary" placeholder="Summary" rows={2} className="input" />
                <textarea name="raw_notes" placeholder="Notes" rows={4} className="input" />
                <input name="themes" placeholder="Themes, comma separated" className="input" />
                <textarea name="decisions" placeholder="Decisions (one per line)" rows={2} className="input" />
                <textarea name="ideas" placeholder="Ideas (one per line)" rows={2} className="input" />
                <textarea name="action_items" placeholder="Action items (one per line)" rows={2} className="input" />
                <input name="linked_clients" placeholder="Clients, comma separated" className="input" />
              </ActionForm>
            </details>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
