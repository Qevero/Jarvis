import Link from "next/link";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDateTime } from "@/lib/dates";
import { missedMessages } from "@/lib/services/personal";
import { Empty, PageHeader, Panel, Tabs } from "@/components/ui";
import { markMessagesSeenAction } from "../actions";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { whatsapp: "WhatsApp", imessage: "iMessage", sms: "SMS", other: "Other" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await dashboardCtx("/messages");
  const { show = "unseen" } = await searchParams;
  const r = await missedMessages(ctx, { hours: show === "all" ? 24 * 14 : 24 * 7, includeSeen: show === "all" });
  const { data: tokens } = await ctx.sb.from("ingest_tokens").select("name, last_used_at").eq("owner_id", ctx.ownerId).contains("scopes", ["messages"]).is("revoked_at", null);

  return (
    <div className="space-y-5">
      <PageHeader label="Personal" title="Missed messages" sub="WhatsApp, iMessage and SMS forwarded from your own Mac or iPhone. Ask Jarvis: “summarise what I've missed”.">
        {r.total > 0 && show === "unseen" && (
          <form action={markMessagesSeenAction}><button className="btn btn-ghost btn-sm">Mark all seen</button></form>
        )}
      </PageHeader>
      <Tabs active={show} tabs={[{ id: "unseen", label: "Unseen", href: "/messages?show=unseen" }, { id: "all", label: "Last 14 days", href: "/messages?show=all" }]} />

      {!tokens?.length ? (
        <Empty action={<Link href="/settings#personal" className="btn btn-primary btn-sm">Set up message forwarding</Link>}>
          Nothing is forwarding messages yet. Use the Mac bridge (WhatsApp + iMessage/SMS) or the iPhone automation (iMessage). See docs/MESSAGES.md.
        </Empty>
      ) : (
        <p className="text-xs text-muted">Forwarding from: {tokens.map((t) => `${t.name}${t.last_used_at ? ` (last ${formatUkDateTime(t.last_used_at)})` : " (not used yet)"}`).join(", ")}. Messages are encrypted and deleted after the retention period.</p>
      )}

      {r.chats.length === 0 ? (
        <Empty>{show === "unseen" ? "You're all caught up. ✓" : "No messages in the last 14 days."}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {r.chats.map((c) => (
            <Panel key={`${c.source}|${c.chat}`} title={`${LABEL[c.source] ?? c.source} · ${c.chat}`} action={<span className="badge">{c.count}</span>}>
              <ul className="space-y-2 text-sm">
                {c.messages.slice(-8).map((m, i) => (
                  <li key={i}>
                    <p className="text-xs text-muted">{m.sender ?? c.chat} · {formatUkDateTime(m.sent_at)}</p>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </li>
                ))}
              </ul>
              {c.count > 8 && <p className="mt-2 text-xs text-muted">+{c.count - 8} earlier</p>}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
