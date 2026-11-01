import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { KNOWLEDGE_KINDS, listConversations, memoryStats, recall, searchChats } from "@/lib/services/knowledge";
import { ActionForm, InlineAction } from "@/components/forms";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { ChatImporter } from "./importer";
import { forgetAction, rememberAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await dashboardCtx("/memory");
  const { q } = await searchParams;
  const [stats, memories, convs, hits] = await Promise.all([memoryStats(ctx), recall(ctx, { query: q, limit: 60 }), listConversations(ctx, { limit: 15 }), q ? searchChats(ctx, q, 10).catch(() => []) : Promise.resolve([])]);

  return (
    <div className="space-y-5">
      <PageHeader label="Memory" title="What Jarvis knows" sub="Durable knowledge Claude saves with “remember…”, plus your imported Claude chat history, searchable from any conversation." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Memories" value={String(stats.memories)} />
        <Stat label="Past chats" value={String(stats.conversations)} />
        <Stat label="Chats digested" value={String(stats.digested)} sub={stats.conversations ? `${Math.round((stats.digested / stats.conversations) * 100)}%` : undefined} />
      </div>

      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search memories and past chats…" className="input" />
        <button className="btn btn-ghost">Search</button>
      </form>

      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          {q && (
            <Panel title={`Past chats matching “${q}”`}>
              {hits.length === 0 ? <p className="text-sm text-muted">No matches in imported chats.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {(hits as { conversation_title: string; snippet: string; sent_at: string | null; sender: string; message_id: string }[]).map((h) => (
                    <li key={h.message_id} className="py-2"><p className="font-medium">{h.conversation_title}</p><p className="text-xs text-muted">{h.sender === "human" ? "You" : "Claude"}{h.sent_at ? ` · ${formatUkDate(h.sent_at)}` : ""}: {h.snippet.replace(/[«»]/g, "")}</p></li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel title={q ? "Matching memories" : "Memories"}>
            {memories.length === 0 ? <Empty>Nothing yet. In Claude, say “Jarvis, remember that…”, or add one here.</Empty> : (
              <ul className="divide-y divide-line">
                {memories.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{m.pinned && "📌 "}{m.title} <span className="badge ml-1">{m.kind}</span>{m.importance >= 4 && <span className="badge ml-1 border-accent/50 text-accent">important</span>}</p>
                      {m.content && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{m.content}</p>}
                      <p className="mt-1 text-xs text-muted">{m.tags.map((t: string) => `#${t}`).join(" ")} · {m.source.replace("_", " ")} · {formatUkDate(m.updated_at)}</p>
                    </div>
                    <InlineAction action={forgetAction} fields={{ id: m.id }} label="Forget" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Add a memory">
            <ActionForm action={rememberAction} submit="Remember" resetOnSuccess className="space-y-2">
              <input name="title" required placeholder="e.g. Minimum SEO retainer" className="input" />
              <textarea name="content" placeholder="Details" rows={3} className="input" />
              <div className="grid grid-cols-2 gap-2">
                <select name="kind" className="input">{KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                <select name="importance" defaultValue="3" className="input">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Importance {n}</option>)}</select>
              </div>
              <input name="tags" placeholder="Tags, comma separated" className="input" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-5 w-5" /> Pin (always in Claude&apos;s context)</label>
            </ActionForm>
          </Panel>
          <Panel title="Import Claude chat history">
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>claude.ai → Settings → Privacy → <b>Export data</b>.</li>
              <li>Download the zip from the email Anthropic sends.</li>
              <li>Choose it below. It&apos;s read on this device; only message text is stored.</li>
              <li>Then in Claude: “Jarvis, go through my undigested past chats and remember what matters.”</li>
            </ol>
            <ChatImporter />
          </Panel>
          <Panel title="Recent imported chats">
            {convs.length === 0 ? <p className="text-sm text-muted">None imported yet.</p> : (
              <ul className="space-y-1.5 text-sm">{convs.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.digested_at ? "✓ " : ""}{c.title}</span><span className="shrink-0 text-xs text-muted">{formatUkDate(c.last_message_at)}</span></li>)}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
