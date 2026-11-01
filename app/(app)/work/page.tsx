import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate, formatUkDateTime, todayUk } from "@/lib/dates";
import { addDays } from "@/lib/periods";
import { connectionStatus } from "@/lib/integrations/connections";
import { GraphClient } from "@/lib/ms/graph";
import { ActionForm, InlineAction } from "@/components/forms";
import { ConnectPrompt, Empty, PageHeader, Panel } from "@/components/ui";
import { addTaskAction, completeTaskAction, createEventAction } from "../actions";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}

export default async function WorkPage() {
  const ctx = await dashboardCtx("/work");
  const ms = await connectionStatus(ctx, "microsoft");
  const header = <PageHeader label="Work" title="Tasks, calendar & inbox" sub={ms?.account_label ? `Microsoft To Do and Outlook · ${ms.account_label}` : "Microsoft To Do and Outlook"} />;
  if (ms?.status !== "active") return (<div>{header}<ConnectPrompt what="Microsoft (Outlook, Calendar, To Do)" /></div>);

  const g = new GraphClient(ctx);
  const today = todayUk();
  const [tasks, events, inbox] = await Promise.all([safe(() => g.listTasks()), safe(() => g.calendar(today, addDays(today, 6))), safe(() => g.inbox({ top: 15, sinceHours: 72 }))]);

  const days = new Map<string, Exclude<typeof events, { error: string }>>();
  if (!("error" in events)) for (const e of events) days.set(e.start.slice(0, 10), [...(days.get(e.start.slice(0, 10)) ?? []), e]);

  return (
    <div className="space-y-5">
      {header}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="To Do">
          <ActionForm action={addTaskAction} submit="Add task" resetOnSuccess className="mb-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
              <input name="title" required placeholder="e.g. Chase World of Beds" className="input" />
              <input name="due" placeholder="Due DD/MM/YYYY" inputMode="numeric" className="input" />
            </div>
          </ActionForm>
          {"error" in tasks ? <Empty>{tasks.error}</Empty> : tasks.length === 0 ? <Empty>All clear. ✓</Empty> : (
            <ul className="divide-y divide-line">
              {tasks.slice(0, 40).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{t.importance === "high" && <span className="text-warn">! </span>}{t.title}</p>
                    <p className={`text-xs ${t.due && t.due < today ? "text-danger" : "text-muted"}`}>{t.list}{t.due ? ` · due ${formatUkDate(t.due)}` : ""}</p>
                  </div>
                  <InlineAction action={completeTaskAction} fields={{ list_id: t.listId, task_id: t.id }} label="Done" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Next 7 days">
          {"error" in events ? <Empty>{events.error}</Empty> : days.size === 0 ? <Empty>Nothing in the diary.</Empty> : (
            <div className="space-y-4">
              {[...days.entries()].map(([day, list]) => (
                <div key={day}>
                  <p className="hud-label mb-1">{day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</p>
                  <ul className="space-y-1">
                    {list.map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span className="w-24 shrink-0 font-mono text-xs text-muted">{e.allDay ? "All day" : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`}</span>
                        <a href={e.webLink} target="_blank" rel="noreferrer" className="hover:text-accent">{e.subject}{e.location ? <span className="text-muted"> · {e.location}</span> : null}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <details className="mt-4">
            <summary className="btn btn-ghost btn-sm cursor-pointer list-none">+ Add event</summary>
            <ActionForm action={createEventAction} submit="Add to calendar" className="mt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="subject" required placeholder="What" className="input sm:col-span-2" />
                <input name="date" required defaultValue={formatUkDate(today)} className="input" />
                <input name="location" placeholder="Where (optional)" className="input" />
                <input name="start" type="time" className="input" aria-label="Start time" />
                <input name="end" type="time" className="input" aria-label="End time" />
              </div>
              <p className="mt-1 text-xs text-muted">Leave times empty for an all-day event. No invitations are sent.</p>
            </ActionForm>
          </details>
        </Panel>
      </div>

      <Panel title="Inbox · last 3 days">
        {"error" in inbox ? <Empty>{inbox.error}</Empty> : inbox.length === 0 ? <Empty>No recent email.</Empty> : (
          <ul className="divide-y divide-line">
            {inbox.map((m) => (
              <li key={m.id} className="py-2.5">
                <a href={m.webLink} target="_blank" rel="noreferrer" className="block">
                  <p className="flex justify-between gap-3 text-sm"><span className={`truncate ${m.unread ? "font-semibold" : ""}`}>{m.from}</span><span className="shrink-0 text-xs text-muted">{formatUkDateTime(m.received)}</span></p>
                  <p className={`truncate text-sm ${m.unread ? "" : "text-muted"}`}>{m.flagged && "🚩 "}{m.subject}</p>
                  <p className="truncate text-xs text-muted">{m.preview}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Ask Jarvis in Claude to summarise your inbox or draft replies — drafts land in Outlook Drafts and are never sent automatically.</p>
      </Panel>
    </div>
  );
}
