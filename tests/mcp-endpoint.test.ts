import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "./memory-store";

/**
 * End-to-end test of the /api/mcp route handler: HTTP → OAuth check →
 * Streamable HTTP transport → tools → vault service. Supabase is replaced by
 * a fake token verifier and an in-memory store.
 */

const ISSUER = "https://abc.supabase.co/auth/v1";
let mem = memoryStore();

vi.mock("@/lib/supabase/server", () => ({
  supabaseAnon: () => ({
    auth: {
      getClaims: async (token: string) =>
        token === "good-token"
          ? { data: { claims: { sub: "user-1", email: "jasper@qevero.com", iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, client_id: "claude", role: "authenticated" } }, error: null }
          : token === "dashboard-token"
            ? { data: { claims: { sub: "user-1", email: "jasper@qevero.com", iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, role: "authenticated" } }, error: null }
            : { data: null, error: new Error("bad") },
    },
  }),
  supabaseWithToken: () => ({}),
}));
vi.mock("@/lib/vault/store", () => ({ supabaseVaultStore: () => mem.store }));

let route: typeof import("@/app/api/mcp/route");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.JARVIS_OWNER_EMAIL = "jasper@qevero.com";
  process.env.VAULT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.JARVIS_SITE_URL = "https://jarvis.example";
  route = await import("@/app/api/mcp/route");
});

beforeEach(() => {
  mem = memoryStore();
});

let id = 0;
function rpc(method: string, params: Record<string, unknown> = {}, token: string | null = "good-token") {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Mcp-Protocol-Version": "2025-06-18" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return route.POST(new Request("https://jarvis.example/api/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }));
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.result as { content: { text: string }[]; isError?: boolean };
}

describe("MCP endpoint", () => {
  it("challenges unauthenticated requests with the resource metadata URL", async () => {
    const res = await rpc("tools/list", {}, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://jarvis.example/.well-known/oauth-protected-resource/api/mcp"');
  });

  it("rejects invalid tokens and plain dashboard sessions", async () => {
    expect((await rpc("tools/list", {}, "forged")).status).toBe(401);
    const res = await rpc("tools/list", {}, "dashboard-token");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("initialises and lists the Company Vault tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe("jarvis");
    expect(initBody.result.instructions).toContain("Qevero");

    const list = await (await rpc("tools/list")).json();
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
    for (const n of ["get_company_profile", "get_document", "list_documents", "update_company_field", "save_journal_entry", "remember", "get_revenue_summary", "get_attention_flags", "create_invoice_draft", "create_purchase_order_draft", "create_proposal", "add_task", "get_calendar", "create_email_draft", "get_upcoming_deadlines", "get_vat_position", "crm_overview", "get_morning_briefing"]) {
      expect(names).toContain(n);
    }
    // Jarvis never sends: no tool may send email.
    expect(names.some((n) => /send/i.test(n))).toBe(false);
    expect(names.length).toBeGreaterThan(55);
  });

  it("answers “what's our VAT number?”", async () => {
    const upd = await callTool("update_company_field", { key: "vat_number", value: "123456789" });
    expect(upd.isError).toBeFalsy();

    const res = await callTool("get_company_profile", { fields: ["vat_number"] });
    const data = JSON.parse(res.content[0].text);
    expect(data.fields.vat_number).toEqual({ label: "VAT number", value: "GB123456789" });

    // The write was audited as coming from Claude's connector.
    expect(mem.audit.at(-1)).toMatchObject({ source: "mcp", client_id: "claude", action: "vault.update_field", target: "vat_number" });
  });

  it("masks the UTR unless reveal is requested", async () => {
    await callTool("update_company_field", { key: "corporation_tax_utr", value: "1234567890" });
    const masked = JSON.parse((await callTool("get_company_profile", { fields: ["corporation_tax_utr"] })).content[0].text);
    expect(masked.fields.corporation_tax_utr).toEqual({ label: "Corporation tax UTR", value: "••••••7890", masked: true });
    const full = JSON.parse((await callTool("get_company_profile", { fields: ["corporation_tax_utr"], reveal: true })).content[0].text);
    expect(full.fields.corporation_tax_utr.value).toBe("1234567890");
  });

  it("includes directors and renewals in the full profile", async () => {
    mem.store.insertItem({ kind: "insurance", name: "PI cover", provider: "Hiscox", reference: null, renewal_date: "2027-10-03", cost_pence: 42000, billing_period: "annual", notes: null });
    const data = JSON.parse((await callTool("get_company_profile")).content[0].text);
    expect(data.insurances[0]).toMatchObject({ name: "PI cover", renewal_date: "03/10/2027", cost: "£420.00" });
    expect(data.fields.vat_number.status).toBe("not set");
  });

  it("returns validation errors to Claude as tool errors", async () => {
    const res = await callTool("update_company_field", { key: "vat_number", value: "nonsense" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/GB followed by 9 digits/);
  });

  it("previews Xero drafts until confirm=true", async () => {
    const res = await callTool("create_invoice_draft", { contact: "World of Beds", lines: [{ description: "Website build", quantity: 1, unit_price: 4500, stream: "website_builds" }] });
    const data = JSON.parse(res.content[0].text);
    expect(data).toMatchObject({ preview: true, kind: "invoice", net: "£4,500.00", vat: "£900.00", total: "£5,400.00" });
    const po = JSON.parse((await callTool("create_purchase_order_draft", { contact: "Stock Photos Ltd", lines: [{ description: "Licences", quantity: 2, unit_price: 25 }] })).content[0].text);
    expect(po).toMatchObject({ preview: true, total: "£60.00" });
  });

  it("lists documents", async () => {
    const data = JSON.parse((await callTool("list_documents")).content[0].text);
    expect(data.documents).toEqual([]);
  });

  it("answers CORS preflight", () => {
    const res = route.OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});
