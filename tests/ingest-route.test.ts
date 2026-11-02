import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

const calls: { kind: string; rows: Record<string, unknown>[] }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  supabaseAnon: () => ({
    rpc: async (_fn: string, args: { p_token: string; p_kind: string; p_rows: Record<string, unknown>[] }) => {
      if (args.p_token !== "jv_good") return { data: null, error: { message: "Invalid or revoked token for x" } };
      calls.push({ kind: args.p_kind, rows: args.p_rows });
      return { data: { kind: args.p_kind, accepted: args.p_rows.length }, error: null };
    },
  }),
}));

let messages: typeof import("@/app/api/ingest/messages/route");
let health: typeof import("@/app/api/ingest/health/route");
const key = randomBytes(32).toString("base64");

beforeAll(async () => {
  process.env.VAULT_ENCRYPTION_KEY = key;
  messages = await import("@/app/api/ingest/messages/route");
  health = await import("@/app/api/ingest/health/route");
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
});
