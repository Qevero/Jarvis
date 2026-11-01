import { z } from "zod";
import { UserError } from "@/lib/ctx";
import { NotConnectedError, ReconnectError } from "@/lib/integrations/connections";
import { VaultError } from "@/lib/vault/service";
import { XeroApiError, XeroBudgetError, XeroRateLimitError } from "@/lib/xero/client";
import { VAT_CODES, type DraftLine } from "@/lib/invoicing/math";
import { STREAM_IDS } from "@/lib/revenue/streams";
import { PERIOD_KEYS } from "@/lib/periods";

type Json = unknown;

export function ok(data: Json) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

export function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Runs a tool body; user-facing errors go back to Claude verbatim, others generically. */
export async function run(fn: () => Promise<Json>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof VaultError || e instanceof UserError || e instanceof NotConnectedError || e instanceof ReconnectError || e instanceof XeroBudgetError || e instanceof XeroRateLimitError || e instanceof XeroApiError) {
      return fail(e.message);
    }
    if (e instanceof z.ZodError) return fail(`Invalid input: ${e.issues.map((i) => i.message).join("; ")}`);
    console.error("[jarvis-mcp] tool error:", e instanceof Error ? e.message : "unknown");
    return fail("Jarvis hit an internal error. Please try again.");
  }
}

export const periodSchema = z.enum(PERIOD_KEYS as [string, ...string[]]).optional().describe("this_month (default), last_month, this_quarter, last_quarter, ytd (financial year to date; FY starts 1 Nov), last_year, last_12_months, all");

export const lineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unit_price: z.number().min(0).describe("Price per unit in pounds, excluding VAT"),
  vat: z.enum(VAT_CODES as [string, ...string[]]).optional().describe("standard (20%, default), reduced (5%), zero, exempt, none"),
  stream: z.enum(STREAM_IDS as [string, ...string[]]).optional().describe("Revenue stream (sales documents)"),
  account_code: z.string().max(10).optional().describe("Xero account code; defaults to 200 Sales (or the purchase default for POs)"),
  billing: z.enum(["one-off", "monthly"]).optional().describe("Proposals only: one-off (default) or monthly fee"),
});

export type LineInput = z.infer<typeof lineSchema>;

export function toDraftLines(lines: LineInput[]): DraftLine[] {
  return lines.map((l) => ({
    description: l.description,
    quantity: l.quantity ?? 1,
    unitPricePence: Math.round(l.unit_price * 100),
    vat: (l.vat as DraftLine["vat"]) ?? "standard",
    stream: l.stream ?? null,
    accountCode: l.account_code ?? null,
    billing: l.billing ?? "one-off",
  }));
}

export const confirmSchema = z.boolean().optional().describe("Must be true to actually create it. Without it Jarvis returns a preview to read back to Jasper first.");
