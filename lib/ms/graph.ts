import { env } from "@/lib/env";
import { audit, UserError, type Ctx } from "@/lib/ctx";
import { getConnection, markConnection, NotConnectedError, ReconnectError, saveTokens } from "@/lib/integrations/connections";

/**
 * Microsoft Graph for a personal Outlook.com account (qevero@outlook.com):
 * Microsoft To Do, Calendar and Mail. Permissions deliberately exclude
 * Mail.Send — Jarvis can create drafts but cannot send email, by design.
 */

export const GRAPH_SCOPES = ["offline_access", "openid", "email", "User.Read", "Tasks.ReadWrite", "Calendars.ReadWrite", "Mail.ReadWrite"];
const GRAPH = "https://graph.microsoft.com/v1.0";
const TZ = "Europe/London";

function authority() {
  const cfg = env.microsoft();
  if (!cfg) throw new Error("MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not set.");
  return { ...cfg, base: `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0` };
}

export function msRedirectUri() {
  return `${env.siteUrl()}/api/integrations/microsoft/callback`;
}

export function msAuthorizeUrl(state: string, challenge: string) {
  const a = authority();
  const u = new URL(`${a.base}/authorize`);
  u.searchParams.set("client_id", a.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", msRedirectUri());
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", GRAPH_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const a = authority();
  const res = await fetch(`${a.base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, scope: GRAPH_SCOPES.join(" "), ...params }),
  });
  if (!res.ok) throw new Error(`Microsoft token request failed (${res.status}).`);
  return (await res.json()) as TokenResponse;
}

export function exchangeMsCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: msRedirectUri(), code_verifier: verifier });
}

type J = Record<string, unknown>;

/** Graph date-time in UK local time, e.g. "2026-11-06T09:00:00". */
function localDateTime(isoDateOrDateTime: string, fallbackTime = "09:00"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDateOrDateTime)) return `${isoDateOrDateTime}T${fallbackTime}:00`;
  return isoDateOrDateTime.slice(0, 19);
}

export class GraphClient {
  private token: string | null = null;
  constructor(private ctx: Ctx) {}

  private async accessToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    const conn = await getConnection(this.ctx, "microsoft");
    if (!conn || conn.status === "disconnected") throw new NotConnectedError("microsoft");
    if (conn.status === "needs_reconnect" || !conn.refreshToken) throw new ReconnectError("microsoft");
    if (!force && conn.accessToken && conn.accessExpiresAt && Date.parse(conn.accessExpiresAt) > Date.now() + 30_000) {
      this.token = conn.accessToken;
      return this.token;
    }
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refreshToken });
      await saveTokens(this.ctx, "microsoft", { accessToken: t.access_token, refreshToken: t.refresh_token ?? conn.refreshToken, expiresIn: t.expires_in, scopes: t.scope ?? conn.scopes });
      this.token = t.access_token;
      return this.token;
    } catch (e) {
      await markConnection(this.ctx, "microsoft", "needs_reconnect", e instanceof Error ? e.message : "Token refresh failed");
      throw new ReconnectError("microsoft");
    }
  }

  async request<T = J>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}, retried = false): Promise<T> {
    if (/\/send(\b|$)/i.test(path)) throw new Error("Jarvis never sends email.");
    const token = await this.accessToken();
    const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Prefer: `outlook.timezone="${TZ}"`, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await this.accessToken(true);
      return this.request(method, path, body, extraHeaders, true);
    }
    if (res.status === 204) return {} as T;
    const json = (await res.json().catch(() => ({}))) as J;
    if (!res.ok) {
      const msg = ((json.error as J)?.message as string) ?? `Graph error ${res.status}`;
      throw new UserError(`Microsoft said: ${msg}`);
    }
    return json as T;
  }

  async me() {
    return this.request<{ mail?: string; userPrincipalName?: string; displayName?: string }>("GET", "/me?$select=displayName,mail,userPrincipalName");
  }

  // ─── Microsoft To Do ──────────────────────────────────────────────────────
  async taskLists() {
    const r = await this.request<{ value: { id: string; displayName: string; wellknownListName?: string }[] }>("GET", "/me/todo/lists");
    return r.value.map((l) => ({ id: l.id, name: l.displayName, isDefault: l.wellknownListName === "defaultList" }));
  }

  async defaultListId(listName?: string | null): Promise<string> {
    const lists = await this.taskLists();
    if (listName) {
      const hit = lists.find((l) => l.name.toLowerCase() === listName.toLowerCase());
      if (!hit) throw new UserError(`No To Do list called "${listName}". Lists: ${lists.map((l) => l.name).join(", ")}.`);
      return hit.id;
    }
    return (lists.find((l) => l.isDefault) ?? lists[0])?.id ?? (() => { throw new UserError("No Microsoft To Do lists found."); })();
  }

  async listTasks(opts: { listName?: string | null; includeCompleted?: boolean; top?: number } = {}) {
    const lists = await this.taskLists();
    const targets = opts.listName ? lists.filter((l) => l.name.toLowerCase() === opts.listName!.toLowerCase()) : lists;
    const out: { id: string; listId: string; list: string; title: string; status: string; due: string | null; importance: string; notes: string | null; created: string }[] = [];
    for (const l of targets.slice(0, 8)) {
      const filter = opts.includeCompleted ? "" : `&$filter=${encodeURIComponent("status ne 'completed'")}`;
      const r = await this.request<{ value: J[] }>("GET", `/me/todo/lists/${l.id}/tasks?$top=${opts.top ?? 50}${filter}`);
      for (const t of r.value) {
        const due = (t.dueDateTime as J | undefined)?.dateTime as string | undefined;
        out.push({ id: t.id as string, listId: l.id, list: l.name, title: t.title as string, status: t.status as string, due: due ? due.slice(0, 10) : null, importance: t.importance as string, notes: ((t.body as J)?.content as string)?.trim() || null, created: t.createdDateTime as string });
      }
    }
    return out.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }

  async addTask(input: { title: string; due?: string | null; notes?: string | null; listName?: string | null; reminder?: string | null; importance?: "low" | "normal" | "high" }) {
    const listId = await this.defaultListId(input.listName);
    const body: J = { title: input.title.slice(0, 255), importance: input.importance ?? "normal" };
    if (input.due) body.dueDateTime = { dateTime: localDateTime(input.due, "00:00"), timeZone: TZ };
    if (input.notes) body.body = { content: input.notes, contentType: "text" };
    if (input.reminder) {
      body.isReminderOn = true;
      body.reminderDateTime = { dateTime: localDateTime(input.reminder, "09:00"), timeZone: TZ };
    }
    const t = await this.request<J>("POST", `/me/todo/lists/${listId}/tasks`, body);
    await audit(this.ctx, "microsoft.add_task", t.id as string, { title: input.title, due: input.due ?? null });
    return { id: t.id as string, listId, title: t.title as string, due: input.due ?? null };
  }

  async completeTask(listId: string, taskId: string) {
    await this.request("PATCH", `/me/todo/lists/${listId}/tasks/${taskId}`, { status: "completed" });
    await audit(this.ctx, "microsoft.complete_task", taskId);
    return { completed: true };
  }

  // ─── Calendar ─────────────────────────────────────────────────────────────
  async calendar(start: string, end: string) {
    const q = new URLSearchParams({ startDateTime: `${start}T00:00:00`, endDateTime: `${end}T23:59:59`, $orderby: "start/dateTime", $top: "100", $select: "subject,start,end,location,isAllDay,isCancelled,organizer,webLink,showAs,onlineMeeting,bodyPreview" });
    const r = await this.request<{ value: J[] }>("GET", `/me/calendarView?${q}`);
    return r.value
      .filter((e) => !e.isCancelled)
      .map((e) => ({
        id: e.id as string,
        subject: (e.subject as string) || "(no title)",
        start: ((e.start as J).dateTime as string).slice(0, 19),
        end: ((e.end as J).dateTime as string).slice(0, 19),
        allDay: Boolean(e.isAllDay),
        location: ((e.location as J)?.displayName as string) || null,
        organiser: (((e.organizer as J)?.emailAddress as J)?.name as string) ?? null,
        online: Boolean(e.onlineMeeting),
        preview: ((e.bodyPreview as string) || "").slice(0, 200) || null,
        webLink: e.webLink as string,
      }));
  }

  /** Creates an event in Jasper's own calendar. No attendees: Jarvis never sends invitations. */
  async createEvent(input: { subject: string; start: string; end: string; allDay?: boolean; location?: string | null; notes?: string | null; reminderMinutes?: number }) {
    const body: J = {
      subject: input.subject.slice(0, 255),
      start: { dateTime: localDateTime(input.start), timeZone: TZ },
      end: { dateTime: localDateTime(input.end, "10:00"), timeZone: TZ },
      isAllDay: Boolean(input.allDay),
      ...(input.location ? { location: { displayName: input.location } } : {}),
      ...(input.notes ? { body: { contentType: "text", content: input.notes } } : {}),
      isReminderOn: true,
      reminderMinutesBeforeStart: input.reminderMinutes ?? 15,
    };
    const e = await this.request<J>("POST", "/me/events", body);
    await audit(this.ctx, "microsoft.create_event", e.id as string, { subject: input.subject, start: input.start });
    return { id: e.id as string, subject: input.subject, start: input.start, end: input.end, webLink: e.webLink as string };
  }

  // ─── Mail (read and draft only) ──────────────────────────────────────────
  private mapMessage(m: J) {
    const from = (m.from as J)?.emailAddress as J | undefined;
    return {
      id: m.id as string,
      subject: (m.subject as string) || "(no subject)",
      from: from ? `${from.name ?? ""} <${from.address ?? ""}>`.trim() : null,
      received: m.receivedDateTime as string,
      preview: ((m.bodyPreview as string) ?? "").slice(0, 300),
      unread: m.isRead === false,
      importance: m.importance as string,
      hasAttachments: Boolean(m.hasAttachments),
      flagged: ((m.flag as J)?.flagStatus as string) === "flagged",
      webLink: m.webLink as string,
    };
  }

  async inbox(opts: { top?: number; unreadOnly?: boolean; sinceHours?: number } = {}) {
    const filters: string[] = [];
    if (opts.unreadOnly) filters.push("isRead eq false");
    if (opts.sinceHours) filters.push(`receivedDateTime ge ${new Date(Date.now() - opts.sinceHours * 3_600_000).toISOString()}`);
    const q = new URLSearchParams({ $top: String(Math.min(opts.top ?? 25, 50)), $orderby: "receivedDateTime desc", $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,importance,hasAttachments,flag,webLink" });
    if (filters.length) q.set("$filter", filters.join(" and "));
    const r = await this.request<{ value: J[] }>("GET", `/me/mailFolders/inbox/messages?${q}`);
    return r.value.map((m) => this.mapMessage(m));
  }

  async searchMail(query: string, top = 15) {
    const q = new URLSearchParams({ $search: `"${query.replace(/"/g, "")}"`, $top: String(Math.min(top, 25)), $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,importance,hasAttachments,flag,webLink" });
    const r = await this.request<{ value: J[] }>("GET", `/me/messages?${q}`, undefined, { ConsistencyLevel: "eventual" });
    return r.value.map((m) => this.mapMessage(m));
  }

  async readMessage(id: string) {
    const m = await this.request<J>("GET", `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,webLink,isRead,importance,hasAttachments,flag`, undefined, { Prefer: `outlook.body-content-type="text"` });
    const body = ((m.body as J)?.content as string) ?? "";
    return { ...this.mapMessage(m), to: ((m.toRecipients as J[]) ?? []).map((r) => (r.emailAddress as J).address), body: body.slice(0, 8000) };
  }

  /** Saves a new email in Drafts. It is NOT sent. */
  async createDraft(input: { to: string[]; cc?: string[]; subject: string; body: string; html?: boolean }) {
    const rec = (list: string[] = []) => list.filter(Boolean).map((address) => ({ emailAddress: { address } }));
    const m = await this.request<J>("POST", "/me/messages", {
      subject: input.subject,
      body: { contentType: input.html ? "HTML" : "Text", content: input.body },
      toRecipients: rec(input.to),
      ccRecipients: rec(input.cc),
    });
    await audit(this.ctx, "microsoft.create_draft", m.id as string, { to: input.to, subject: input.subject });
    return { id: m.id as string, subject: input.subject, to: input.to, webLink: m.webLink as string, sent: false, note: "Saved to Outlook Drafts. Open it in Outlook to review and send." };
  }

  /** Saves a reply (or reply-all) to an existing email in Drafts. It is NOT sent. */
  async createReplyDraft(messageId: string, body: string, replyAll = false) {
    const draft = await this.request<J>("POST", `/me/messages/${encodeURIComponent(messageId)}/${replyAll ? "createReplyAll" : "createReply"}`, { comment: body });
    await audit(this.ctx, "microsoft.create_reply_draft", draft.id as string, { inReplyTo: messageId, replyAll });
    return { id: draft.id as string, subject: draft.subject as string, webLink: draft.webLink as string, sent: false, note: "Reply saved to Outlook Drafts — review and send it yourself." };
  }
}
