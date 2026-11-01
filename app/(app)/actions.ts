"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { savePrefs, UserError, audit } from "@/lib/ctx";
import { dashboardCtx } from "@/lib/dashboard-ctx";
import { markConnection, NotConnectedError, ReconnectError } from "@/lib/integrations/connections";
import { parseDate } from "@/lib/dates";
import { GraphClient } from "@/lib/ms/graph";
import { sendPush } from "@/lib/push";
import { isStreamId } from "@/lib/revenue/streams";
import { mergePrefs } from "@/lib/settings-defaults";
import { deleteClient, importClientsFromXero, upsertClient } from "@/lib/services/clients";
import { deleteJournalEntry, getJournalEntry, markActionPushed, saveJournalEntry } from "@/lib/services/journal";
import { forget, remember, KNOWLEDGE_KINDS, type KnowledgeKind } from "@/lib/services/knowledge";
import { createProposal, deleteProposal, invoiceFromProposal, proposalToXeroQuote, sanitiseLines, setProposalStatus, updateProposal, type ProposalRow } from "@/lib/services/proposals";
import { markDeadlineDone, verifyRule } from "@/lib/services/tax";
import type { RuleId } from "@/lib/tax/rules";
import { createInvoiceDraft, createPurchaseOrderDraft, createQuoteDraft, setupRevenueStreamTracking } from "@/lib/xero/actions";
import { XeroApiError, XeroBudgetError, XeroRateLimitError } from "@/lib/xero/client";
import { syncXero } from "@/lib/xero/sync";
import type { ActionState } from "@/components/forms";

const s = (fd: FormData, k: string) => (fd.get(k) === null ? "" : String(fd.get(k)).trim());
const list = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function err(e: unknown): ActionState {
  if (e instanceof UserError || e instanceof NotConnectedError || e instanceof ReconnectError || e instanceof XeroApiError || e instanceof XeroBudgetError || e instanceof XeroRateLimitError) return { ok: false, message: e.message };
  console.error("[jarvis] action failed:", e instanceof Error ? e.message : "unknown");
  return { ok: false, message: "Something went wrong. Please try again." };
}

function linesFrom(fd: FormData) {
  try {
    return sanitiseLines(JSON.parse(s(fd, "lines") || "[]"));
  } catch {
    throw new UserError("Couldn't read the line items.");
  }
}

const date = (v: string) => {
  if (!v) return undefined;
  const iso = parseDate(v);
  if (!iso) throw new UserError(`"${v}" isn't a valid date (DD/MM/YYYY).`);
  return iso;
};

// ─── Journal ────────────────────────────────────────────────────────────────
export async function saveJournalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/journal");
    const id = s(fd, "id") || undefined;
    const e = await saveJournalEntry(ctx, {
      title: s(fd, "title") || s(fd, "raw_notes").slice(0, 60) || "Quick note",
      raw_notes: s(fd, "raw_notes"),
      summary: s(fd, "summary"),
      themes: list(s(fd, "themes")),
      decisions: list(s(fd, "decisions")),
      ideas: list(s(fd, "ideas")),
      action_items: list(s(fd, "action_items")),
      linked_clients: list(s(fd, "linked_clients")),
      entry_date: s(fd, "entry_date") || null,
      source: s(fd, "source") === "voice" ? "voice" : "dashboard",
    }, id);
    revalidatePath("/journal");
    return { ok: true, message: id ? "Saved" : "Saved to journal", href: `/journal/${e.id}` };
  } catch (e) {
    return err(e);
  }
}

export async function deleteJournalAction(fd: FormData) {
  const ctx = await dashboardCtx("/journal");
  await deleteJournalEntry(ctx, s(fd, "id"));
  revalidatePath("/journal");
  redirect("/journal");
}

export async function pushActionToTodoAction(fd: FormData) {
  const ctx = await dashboardCtx("/journal");
  const entry = await getJournalEntry(ctx, s(fd, "id"));
  const index = Number(s(fd, "index"));
  const item = entry.action_items[index];
  if (item && !item.pushed_task_id) {
    const t = await new GraphClient(ctx).addTask({ title: item.text, due: item.due ?? null, notes: `From journal: ${entry.title}` });
    await markActionPushed(ctx, entry, index, t.id);
  }
  revalidatePath(`/journal/${entry.id}`);
}

// ─── Memory ─────────────────────────────────────────────────────────────────
export async function rememberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/memory");
    const kind = s(fd, "kind") as KnowledgeKind;
    const r = await remember(ctx, { title: s(fd, "title"), content: s(fd, "content"), kind: KNOWLEDGE_KINDS.includes(kind) ? kind : "fact", tags: list(s(fd, "tags")), importance: Number(s(fd, "importance")) || 3, pinned: fd.get("pinned") === "on" });
    revalidatePath("/memory");
    return { ok: true, message: r.updated ? "Memory updated" : "Remembered" };
  } catch (e) {
    return err(e);
  }
}

export async function forgetAction(fd: FormData) {
  const ctx = await dashboardCtx("/memory");
  await forget(ctx, s(fd, "id"));
  revalidatePath("/memory");
}

// ─── Clients ────────────────────────────────────────────────────────────────
export async function saveClientAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/clients");
    await upsertClient(ctx, { id: s(fd, "id") || undefined, name: s(fd, "name"), xeroContactId: s(fd, "xero_contact_id") || null, email: s(fd, "email") || null, status: s(fd, "status") || "active", primaryStream: s(fd, "primary_stream") || null, retainerMonthly: s(fd, "retainer") || null, retainerInvoiceDay: Number(s(fd, "retainer_day")) || null, notes: s(fd, "notes") || null });
    revalidatePath("/clients");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return err(e);
  }
}

export async function deleteClientAction(fd: FormData) {
  const ctx = await dashboardCtx("/clients");
  await deleteClient(ctx, s(fd, "id"));
  revalidatePath("/clients");
}

export async function importClientsAction(): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/clients");
    const r = await importClientsFromXero(ctx);
    revalidatePath("/clients");
    return { ok: true, message: `${r.added} client${r.added === 1 ? "" : "s"} added from Xero` };
  } catch (e) {
    return err(e);
  }
}

// ─── Revenue mapping ────────────────────────────────────────────────────────
export async function mapAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/revenue/mapping");
    const code = s(fd, "account_code");
    const stream = s(fd, "stream");
    if (!code) throw new UserError("Account code required.");
    if (stream === "") await ctx.sb.from("stream_account_map").delete().eq("owner_id", ctx.ownerId).eq("account_code", code);
    else {
      if (!isStreamId(stream)) throw new UserError("Choose a stream.");
      await ctx.sb.from("stream_account_map").upsert({ owner_id: ctx.ownerId, account_code: code, stream }, { onConflict: "owner_id,account_code" });
    }
    await audit(ctx, "revenue.map_account", code, { stream: stream || null });
    revalidatePath("/revenue");
    revalidatePath("/revenue/mapping");
    return { ok: true, message: "Mapping saved" };
  } catch (e) {
    return err(e);
  }
}

export async function overrideLineAction(fd: FormData) {
  const ctx = await dashboardCtx("/revenue/mapping");
  const key = s(fd, "line_key");
  const stream = s(fd, "stream");
  if (!isStreamId(stream)) return;
  await ctx.sb.from("stream_line_overrides").upsert({ owner_id: ctx.ownerId, line_key: key, stream }, { onConflict: "owner_id,line_key" });
  await audit(ctx, "revenue.override_line", key, { stream });
  revalidatePath("/revenue/mapping");
  revalidatePath("/revenue");
}

// ─── Xero ───────────────────────────────────────────────────────────────────
export async function syncXeroAction(): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/settings");
    const r = await syncXero(ctx, { budgetMs: 25_000 });
    revalidatePath("/", "layout");
    if (r.error) return { ok: false, message: r.error };
    const rows = Object.values(r.resources).reduce((a, x) => a + x.rows, 0);
    return { ok: true, message: r.complete ? `Synced (${rows} changes, ${r.calls} API calls)` : `Partly synced (${rows} changes) — run again to continue` };
  } catch (e) {
    return err(e);
  }
}

export async function setupTrackingAction(): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/settings");
    const r = await setupRevenueStreamTracking(ctx);
    await syncXero(ctx, { budgetMs: 4000 }).catch(() => null);
    return { ok: true, message: r.added.length ? `Created "${r.category}" with ${r.added.join(", ")}` : `"${r.category}" already set up` };
  } catch (e) {
    return err(e);
  }
}

export async function disconnectAction(fd: FormData) {
  const ctx = await dashboardCtx("/settings");
  const provider = s(fd, "provider") === "xero" ? "xero" : "microsoft";
  await markConnection(ctx, provider, "disconnected", null);
  await audit(ctx, `${provider}.disconnect`);
  revalidatePath("/settings");
}

export async function createInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/invoices");
    const r = await createInvoiceDraft(ctx, { contact: { name: s(fd, "contact"), email: s(fd, "email") || null, createIfMissing: fd.get("create_contact") === "on" }, lines: linesFrom(fd), date: date(s(fd, "date")), dueDate: date(s(fd, "due_date")), reference: s(fd, "reference") || null });
    revalidatePath("/invoices");
    return { ok: true, message: `Draft invoice created in Xero for ${r.contact}. Review, approve and send it in Xero.`, href: r.xeroUrl };
  } catch (e) {
    return err(e);
  }
}

export async function createQuoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/invoices");
    const r = await createQuoteDraft(ctx, { contact: { name: s(fd, "contact"), email: s(fd, "email") || null, createIfMissing: fd.get("create_contact") === "on" }, lines: linesFrom(fd), title: s(fd, "title") || null, expiryDate: date(s(fd, "expiry_date")) ?? null, reference: s(fd, "reference") || null });
    return { ok: true, message: `Draft quote created in Xero for ${r.contact}.`, href: r.xeroUrl };
  } catch (e) {
    return err(e);
  }
}

export async function createPurchaseOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/invoices");
    const r = await createPurchaseOrderDraft(ctx, { contact: { name: s(fd, "contact"), email: s(fd, "email") || null, createIfMissing: fd.get("create_contact") === "on" }, lines: linesFrom(fd), deliveryDate: date(s(fd, "delivery_date")) ?? null, reference: s(fd, "reference") || null, deliveryInstructions: s(fd, "instructions") || null });
    return { ok: true, message: `Draft purchase order created in Xero for ${r.supplier}.`, href: r.xeroUrl };
  } catch (e) {
    return err(e);
  }
}

// ─── Proposals ──────────────────────────────────────────────────────────────
export async function createProposalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await dashboardCtx("/proposals");
    const p = await createProposal(ctx, { title: s(fd, "title"), clientName: s(fd, "client_name"), template: s(fd, "template"), contactName: s(fd, "contact_name") || null, contactEmail: s(fd, "contact_email") || null });
    id = p.id;
  } catch (e) {
    return err(e);
  }
  redirect(`/proposals/${id}`);
}

export async function saveProposalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/proposals");
    const id = s(fd, "id");
    const headings = fd.getAll("section_heading").map(String);
    const bodies = fd.getAll("section_body").map(String);
    await updateProposal(ctx, id, {
      title: s(fd, "title"),
      client_name: s(fd, "client_name"),
      contact_name: s(fd, "contact_name") || null,
      contact_email: s(fd, "contact_email") || null,
      intro: s(fd, "intro") || null,
      sections: headings.map((h, i) => ({ heading: h, body: bodies[i] ?? "" })),
      line_items: JSON.parse(s(fd, "lines") || "[]"),
      terms: s(fd, "terms") || null,
      deposit_percent: Number(s(fd, "deposit_percent")) || 0,
      valid_until: s(fd, "valid_until") || null,
    });
    revalidatePath(`/proposals/${id}`);
    revalidatePath("/proposals");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return err(e);
  }
}

export async function proposalStatusAction(fd: FormData) {
  const ctx = await dashboardCtx("/proposals");
  await setProposalStatus(ctx, s(fd, "id"), s(fd, "status") as ProposalRow["status"]);
  revalidatePath(`/proposals/${s(fd, "id")}`);
  revalidatePath("/proposals");
}

export async function deleteProposalAction(fd: FormData) {
  const ctx = await dashboardCtx("/proposals");
  await deleteProposal(ctx, s(fd, "id"));
  revalidatePath("/proposals");
  redirect("/proposals");
}

export async function proposalQuoteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/proposals");
    const q = await proposalToXeroQuote(ctx, s(fd, "id"), fd.get("create_contact") === "on");
    revalidatePath(`/proposals/${s(fd, "id")}`);
    return { ok: true, message: `Draft quote ${q.number ?? ""} created in Xero.`, href: q.xeroUrl };
  } catch (e) {
    return err(e);
  }
}

export async function proposalInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/proposals");
    const which = s(fd, "which") as "deposit" | "full" | "monthly";
    const r = await invoiceFromProposal(ctx, s(fd, "id"), { which, createContact: fd.get("create_contact") === "on" });
    revalidatePath(`/proposals/${s(fd, "id")}`);
    return { ok: true, message: `Draft invoice created in Xero for ${r.contact}.`, href: r.xeroUrl };
  } catch (e) {
    return err(e);
  }
}

// ─── Work (Microsoft) ───────────────────────────────────────────────────────
export async function addTaskAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/work");
    await new GraphClient(ctx).addTask({ title: s(fd, "title"), due: date(s(fd, "due")) ?? null, notes: s(fd, "notes") || null, listName: s(fd, "list") || null });
    revalidatePath("/work");
    return { ok: true, message: "Added to Microsoft To Do" };
  } catch (e) {
    return err(e);
  }
}

export async function completeTaskAction(fd: FormData) {
  const ctx = await dashboardCtx("/work");
  await new GraphClient(ctx).completeTask(s(fd, "list_id"), s(fd, "task_id"));
  revalidatePath("/work");
}

export async function createEventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/work");
    const d = date(s(fd, "date"));
    if (!d) throw new UserError("Pick a date.");
    const start = s(fd, "start") ? `${d}T${s(fd, "start")}:00` : d;
    const end = s(fd, "end") ? `${d}T${s(fd, "end")}:00` : s(fd, "start") ? new Date(Date.parse(`${start}Z`) + 3_600_000).toISOString().slice(0, 19) : d;
    await new GraphClient(ctx).createEvent({ subject: s(fd, "subject"), start, end, allDay: !s(fd, "start"), location: s(fd, "location") || null });
    revalidatePath("/work");
    return { ok: true, message: "Added to your calendar" };
  } catch (e) {
    return err(e);
  }
}

// ─── Tax ────────────────────────────────────────────────────────────────────
export async function deadlineDoneAction(fd: FormData) {
  const ctx = await dashboardCtx("/tax");
  await markDeadlineDone(ctx, s(fd, "key"), s(fd, "note") || null, s(fd, "undo") === "1");
  revalidatePath("/tax");
  revalidatePath("/");
}

export async function verifyRuleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/tax");
    const by = s(fd, "verified_by");
    if (!by && s(fd, "revoke") !== "1") throw new UserError("Who confirmed it? (e.g. your accountant's name)");
    await verifyRule(ctx, s(fd, "rule_id") as RuleId, by, s(fd, "note") || null, s(fd, "revoke") === "1");
    revalidatePath("/tax");
    return { ok: true, message: s(fd, "revoke") === "1" ? "Marked unverified" : "Rule marked as verified" };
  } catch (e) {
    return err(e);
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────
export async function savePrefsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/settings");
    const num = (k: string) => (s(fd, k) === "" ? undefined : Number(s(fd, k)));
    const patch = mergePrefs({
      streamDropPct: num("streamDropPct"),
      streamDropMinAverage: num("streamDropMinAverage"),
      overdueDays: num("overdueDays"),
      concentrationTop1Pct: num("concentrationTop1Pct"),
      concentrationTop3Pct: num("concentrationTop3Pct"),
      retainerGraceDay: num("retainerGraceDay"),
      staleDraftDays: num("staleDraftDays"),
      proposalFollowUpDays: num("proposalFollowUpDays"),
      briefingHour: num("briefingHour"),
      paymentTermsDays: num("paymentTermsDays"),
      xeroSyncHours: num("xeroSyncHours"),
      xeroDailyCallBudget: num("xeroDailyCallBudget"),
      associatedCompanies: num("associatedCompanies"),
      defaultSalesAccount: s(fd, "defaultSalesAccount") || undefined,
      defaultPurchaseAccount: s(fd, "defaultPurchaseAccount") || undefined,
      reminderLeadDays: s(fd, "reminderLeadDays") ? list(s(fd, "reminderLeadDays")).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 120) : undefined,
      deadlineTasks: fd.get("deadlineTasks") === "on",
    });
    await savePrefs(ctx, patch);
    revalidatePath("/settings");
    return { ok: true, message: "Settings saved" };
  } catch (e) {
    return err(e);
  }
}

export async function testPushAction(): Promise<ActionState> {
  try {
    const ctx = await dashboardCtx("/settings");
    const r = await sendPush(ctx, { title: "Jarvis", body: "Notifications are working.", url: "/settings", tag: "test" });
    return r.sent ? { ok: true, message: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}` } : { ok: false, message: "No devices subscribed, or VAPID keys aren't set." };
  } catch (e) {
    return err(e);
  }
}
