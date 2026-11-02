import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDateTime } from "@/lib/dates";
import { listCaptures } from "@/lib/services/labs";
import { messageCounts } from "@/lib/services/personal";
import { ActionForm, InlineAction } from "@/components/forms";
import { Empty, PageHeader, Panel, Tabs } from "@/components/ui";
import { captureNoteAction, captureStatusAction, captureToJournalAction, deleteCaptureAction } from "../actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, { icon: string; label: string }> = {
  note: { icon: "📝", label: "Note" },
  link: { icon: "🔗", label: "Link" },
  whatsapp: { icon: "💬", label: "WhatsApp chat" },
  file: { icon: "📄", label: "File" },
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await dashboardCtx("/inbox");
  const { show = "new" } = await searchParams;
  const [items, msgs] = await Promise.all([listCaptures(ctx, { status: show === "done" ? "done" : "new" }), messageCounts(ctx).catch(() => null)]);

  return (
    <div className="space-y-5 fade-in">
      <PageHeader label="Inbox" title="Everything you've sent to Jarvis" sub="Share anything from your iPhone with “Send to Jarvis” — links, notes, screenshots' text, WhatsApp chats. Ask Claude: “go through my Jarvis inbox”." />

      <Panel>
        <ActionForm action={captureNoteAction} submit="Capture" resetOnSuccess>
          <textarea name="text" rows={2} placeholder="Jot something down, or paste a link…" className="input" />
        </ActionForm>
      </Panel>

      {msgs && msgs.unseen > 0 && (
        <Link href="/messages" className="flex items-center justify-between rounded-2xl border border-line bg-panel px-5 py-4 text-sm hover:border-line-strong">
          <span>💬 {msgs.unseen} unread message{msgs.unseen > 1 ? "s" : ""} in {msgs.chats} chat{msgs.chats > 1 ? "s" : ""}</span>
          <span className="text-accent">Messages →</span>
        </Link>
      )}

      <Tabs active={show} tabs={[{ id: "new", label: "To do", href: "/inbox?show=new" }, { id: "done", label: "Done", href: "/inbox?show=done" }]} />

      {items.length === 0 ? (
        <Empty action={<a href="https://github.com/Qevero/Jarvis/blob/main/docs/IPHONE-SHORTCUTS.md#5-send-to-jarvis-share-sheet" className="btn btn-ghost btn-sm">Set up “Send to Jarvis”</a>}>
          {show === "done" ? "Nothing archived yet." : "Inbox zero. ✓ Share something from your phone, or type above."}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => {
            const k = KIND[c.kind] ?? KIND.note;
            return (
              <li key={c.id} className="panel p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none" aria-hidden="true">{k.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-accent">{c.title ?? c.url}</a> : c.title ?? k.label}</p>
                    <p className="text-xs text-muted">{k.label} · {formatUkDateTime(c.created_at)}{c.kind === "whatsapp" && c.meta.messages !== undefined ? ` · ${String(c.meta.messages)} messages imported` : ""}</p>
                    {c.text && c.kind !== "whatsapp" && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-fg/85">{c.text}</p>}
                    {c.kind === "whatsapp" && <Link href="/messages?show=all" className="mt-2 inline-block text-sm text-accent">Read in Messages →</Link>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 pl-8">
                  {show === "new" ? <InlineAction action={captureStatusAction} fields={{ id: c.id, status: "done" }} label="Done" className="btn btn-ghost btn-sm" /> : <InlineAction action={captureStatusAction} fields={{ id: c.id, status: "new" }} label="Move back" className="btn btn-ghost btn-sm" />}
                  {c.kind !== "whatsapp" && <InlineAction action={captureToJournalAction} fields={{ id: c.id }} label="→ Journal" className="btn btn-ghost btn-sm" />}
                  <InlineAction action={deleteCaptureAction} fields={{ id: c.id }} label="Delete" className="btn btn-ghost btn-sm text-muted" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
