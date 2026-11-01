import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DOCUMENT_CATEGORIES, FIELDS, ITEM_KINDS } from "@/lib/vault/fields";
import { VaultError, type VaultService } from "@/lib/vault/service";

/**
 * The Jarvis MCP server. Each request builds a fresh server bound to the
 * caller's verified token, so every tool runs under Row Level Security.
 * Tools return JSON so Claude can reason over the data and explain it.
 */

export const SERVER_INSTRUCTIONS = `You are connected to Jarvis, the business assistant for Qevero Ltd (a UK digital agency run by Jasper Sayer).
Use UK English, GBP and DD/MM/YYYY dates.
Company facts (company number, VAT number, year end, insurance, suppliers, documents) come from the Company Vault tools. Always look facts up rather than guessing.
Sensitive fields (UTR, bank details) are masked by default. Only pass reveal=true when Jasper explicitly asks for the full value.
Before changing anything with update_company_field, read back the change to Jasper and get a clear yes.`;

type Json = Record<string, unknown> | unknown[];

function ok(data: Json) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

async function run(fn: () => Promise<Json>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof VaultError) return fail(e.message);
    // Internal errors are reported generically; details stay server-side.
    console.error("[jarvis-mcp] tool error:", e instanceof Error ? e.message : "unknown");
    return fail("Jarvis hit an internal error. Please try again.");
  }
}

const fieldKeys = FIELDS.map((f) => f.key) as [string, ...string[]];

export function buildMcpServer(vault: VaultService) {
  const server = new McpServer({ name: "jarvis", title: "Jarvis (Qevero)", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "get_company_profile",
    {
      title: "Get company profile",
      description:
        "Qevero's core company information from the Company Vault: legal name, company number, incorporation date, registered office, VAT number and registration, VAT scheme and quarters, accounting year end, UTR, bank details, accountant, plus directors, insurance policies, key suppliers and subscriptions with renewal dates. Sensitive fields are masked unless reveal=true.",
      inputSchema: {
        fields: z.array(z.enum(fieldKeys)).optional().describe("Only return these field keys. Omit for everything."),
        include_items: z.boolean().optional().describe("Include directors, insurance, suppliers and subscriptions. Default true."),
        reveal: z.boolean().optional().describe("Return sensitive values (UTR, bank details) in full. Only when Jasper explicitly asks. Logged in the audit trail."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ fields, include_items, reveal }) =>
      run(async () => {
        const profile = await vault.getProfile({ reveal: reveal === true, keys: fields });
        const result: Record<string, unknown> = {
          fields: Object.fromEntries(
            profile.map((f) => [f.key, { label: f.label, value: f.display, ...(f.masked ? { masked: true } : {}), ...(f.display === null ? { status: "not set" } : {}) }]),
          ),
        };
        if (include_items !== false && !fields?.length) {
          const items = (await vault.listItems()).map(vault.presentItem);
          for (const kind of ITEM_KINDS) result[`${kind}s`] = items.filter((i) => i.kind === kind);
        }
        return result;
      }),
  );

  server.registerTool(
    "update_company_field",
    {
      title: "Update company field",
      description: `Set or clear one Company Vault field. Confirm the exact change with Jasper first. Dates as DD/MM/YYYY; year end as DD/MM. Pass an empty string to clear. Valid keys: ${FIELDS.map((f) => `${f.key} (${f.label})`).join(", ")}.`,
      inputSchema: {
        key: z.enum(fieldKeys).describe("Field key"),
        value: z.string().max(2000).describe("New value, or empty string to clear"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ key, value }) => run(async () => ({ updated: await vault.updateField(key, value) })),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: "List documents stored in the Company Vault (certificate of incorporation, VAT certificate, insurance schedules, etc.).",
      inputSchema: { category: z.enum(DOCUMENT_CATEGORIES).optional().describe("Filter by category") },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => run(async () => ({ documents: await vault.listDocuments(category) })),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: "Get a Company Vault document's details and a private download link that expires after 10 minutes.",
      inputSchema: { id: z.string().uuid().describe("Document id from list_documents") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => run(async () => vault.getDocument(id)),
  );

  return server;
}
