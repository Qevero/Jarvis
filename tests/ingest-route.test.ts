import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const calls: { kind: string; rows: Record<string, unknown>[] }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  supabaseAnon: () => ({
    rpc: async (fn: string, args: { p_token: string; p_kind: string; p_rows: Record<string, unknown>[] }) => {
      if (args.p_token !== "jv_good") return { data: null, error: { message: "Invalid or revoked token for x" } };
      if (fn === "jarvis_capture") {
        calls.push({ kind: "capture", rows: [args as never] });
        return { data: "00000000-0000-0000-0000-000000000001", error: null };
      }
      calls.push({ kind: args.p_kind, rows: args.p_rows });
      return { data: { kind: args.p_kind, accepted: args.p_rows.length }, error: null };
    },
  }),
}));

let messages: typeof import("@/app/api/ingest/messages/route");
let capture: typeof import("@/app/api/ingest/capture/route");
let health: typeof import("@/app/api/ingest/health/route");
const key = randomBytes(32).toString("base64");

beforeAll(async () => {
  process.env.VAULT_ENCRYPTION_KEY = key;
  messages = await import("@/app/api/ingest/messages/route");
  health = await import("@/app/api/ingest/health/route");
  capture = await import("@/app/api/ingest/capture/route");
});

const req = (path: string, body: unknown, token: string | null = "jv_good") =>
  new Request(`https://jarvis.example${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

describe("device ingest routes", () => {
  it("rejects missing and bad tokens", async () => {
    expect((await health.POST(req("/api/ingest/health", { day: "2026-11-02", calories: 2000 }, null))).status).toBe(401);
    expect((await health.POST(req("/api/ingest/health", { day: "2026-11-02", calories: 2000 }, "jv_bad"))).status).toBe(401);
  });

  it("normalises a Shortcut health payload", async () => {
    const res = await health.POST(req("/api/ingest/health", { day: "02/11/2026", calories: "2,104 kcal", weight: "82.4 kg" }));
    expect(await res.json()).toEqual({ kind: "health", accepted: 1 });
    expect(calls.at(-1)!.rows[0]).toMatchObject({ day: "2026-11-02", energy_kcal: 2104, weight_kg: 82.4 });
  });

  it("encrypts message text before it reaches the database, and forwards read receipts", async () => {
    const { decrypt } = await import("@/lib/crypto");
    await messages.POST(req("/api/ingest/messages", { messages: [{ source: "whatsapp", external_id: "w1", chat: "Mum", text: "Ring me back please" }], read: [{ source: "imessage", external_id: "g9" }] }));
    const [readCall, msgCall] = calls.slice(-2);
    expect(readCall).toEqual({ kind: "messages_read", rows: [{ source: "imessage", external_id: "g9" }] });
    const row = msgCall.rows[0];
    expect(JSON.stringify(row)).not.toContain("Ring me back");
    expect(decrypt(String(row.body_enc), key)).toBe("Ring me back please");
  });

  it("turns a shared WhatsApp export (zip, form upload) into encrypted messages plus an Inbox item", async () => {
    const { zipSync, strToU8 } = await import("fflate");
    const { decrypt } = await import("@/lib/crypto");
    const now = new Date();
    const d = (m: number) => {
      const t = new Date(now.getTime() - m * 60_000);
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(t);
      const g = (k: string) => p.find((x) => x.type === k)!.value;
      return `[${g("day")}/${g("month")}/${g("year")}, ${g("hour")}:${g("minute")}:${g("second")}]`;
    };
    const chat = `${d(30)} Dan: Game moved to 7pm\n${d(20)} Jasper Sayer: I'm in\n${d(10)} Sam: Can't make it`;
    const zip = zipSync({ "_chat.txt": strToU8(chat) });
    const fd = new FormData();
    fd.set("content", new File([zip], "WhatsApp Chat - 5-a-side.zip", { type: "application/zip" }));
    const before = calls.length;
    const res = await capture.POST(new Request("https://jarvis.example/api/ingest/capture", { method: "POST", headers: { Authorization: "Bearer jv_good" }, body: fd }));
    const body = await res.json();
    expect(body.message).toMatch(/2 messages from “5-a-side”/);
    const msgCall = calls.slice(before).find((c) => c.kind === "messages")!;
    expect(msgCall.rows.map((r) => r.sender)).toEqual(["Dan", "Sam"]);
    expect(decrypt(String(msgCall.rows[0].body_enc), key)).toBe("Game moved to 7pm");
  });

  it("saves a shared link as an Inbox item and rejects tokens without the capture scope", async () => {
    const ok = await capture.POST(new Request("https://jarvis.example/api/ingest/capture", { method: "POST", headers: { Authorization: "Bearer jv_good", "Content-Type": "application/json" }, body: JSON.stringify({ text: "https://qevero.com/blog/geo" }) }));
    expect((await ok.json()).message).toBe("Saved link: qevero.com/blog/geo");
    const bad = await capture.POST(new Request("https://jarvis.example/api/ingest/capture", { method: "POST", headers: { Authorization: "Bearer jv_bad", "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" }) }));
    expect(bad.status).toBe(401);
  });
});
