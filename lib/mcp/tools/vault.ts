import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { companiesHouseProfile } from "@/lib/companies-house";
import { vaultValues, type Ctx } from "@/lib/ctx";
import { DOCUMENT_CATEGORIES, FIELDS, ITEM_KINDS } from "@/lib/vault/fields";
import type { VaultService } from "@/lib/vault/service";
import { run } from "../util";

const fieldKeys = FIELDS.map((f) => f.key) as [string, ...string[]];

export function registerVaultTools(server: McpServer, ctx: Ctx, vault: VaultService) {
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

  server.registerTool(
    "check_companies_house",
    {
      title: "Check Companies House",
      description: "Live Companies House record for Qevero (or another company number): status, registered office, SIC codes, officers and the official next accounts and confirmation statement due dates. Use it to cross-check Jarvis's deadlines.",
      inputSchema: { company_number: z.string().regex(/^[A-Za-z0-9]{8}$/).optional().describe("Defaults to Qevero's company number from the vault") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ company_number }) =>
      run(async () => {
        const number = company_number ?? (await vaultValues(ctx)).company_number;
        if (!number) throw new Error("No company number in the vault.");
        return companiesHouseProfile(number.toUpperCase());
      }),
  );
}
