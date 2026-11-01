/**
 * Invoice / quote / PO arithmetic in pence (integers), VAT per line, matching
 * Xero's line-level rounding for "Tax exclusive" documents.
 */

export const VAT_RATES = {
  standard: { label: "20% (Standard)", rate: 0.2, salesTaxType: "OUTPUT2", purchaseTaxType: "INPUT2" },
  reduced: { label: "5% (Reduced)", rate: 0.05, salesTaxType: "RROUTPUT", purchaseTaxType: "RRINPUT" },
  zero: { label: "0% (Zero rated)", rate: 0, salesTaxType: "ZERORATEDOUTPUT", purchaseTaxType: "ZERORATEDINPUT" },
  exempt: { label: "Exempt", rate: 0, salesTaxType: "EXEMPTOUTPUT", purchaseTaxType: "EXEMPTINPUT" },
  none: { label: "No VAT (outside scope)", rate: 0, salesTaxType: "NONE", purchaseTaxType: "NONE" },
} as const;

export type VatCode = keyof typeof VAT_RATES;
export const VAT_CODES = Object.keys(VAT_RATES) as VatCode[];

export type DraftLine = {
  description: string;
  quantity: number;
  unitPricePence: number;
  vat?: VatCode;
  stream?: string | null;
  accountCode?: string | null;
  /** For proposals: one-off or monthly fee. */
  billing?: "one-off" | "monthly";
};

export type LineTotals = { netPence: number; vatPence: number; grossPence: number };

export function lineTotals(l: DraftLine): LineTotals {
  const netPence = Math.round(l.quantity * l.unitPricePence);
  const vatPence = Math.round(netPence * VAT_RATES[l.vat ?? "standard"].rate);
  return { netPence, vatPence, grossPence: netPence + vatPence };
}

export function documentTotals(lines: DraftLine[]) {
  const per = lines.map(lineTotals);
  const netPence = per.reduce((a, t) => a + t.netPence, 0);
  const vatPence = per.reduce((a, t) => a + t.vatPence, 0);
  const vatByRate: Partial<Record<VatCode, number>> = {};
  lines.forEach((l, i) => {
    const code = l.vat ?? "standard";
    vatByRate[code] = (vatByRate[code] ?? 0) + per[i].vatPence;
  });
  const oneOff = lines.filter((l) => (l.billing ?? "one-off") === "one-off");
  const monthly = lines.filter((l) => l.billing === "monthly");
  const sumNet = (ls: DraftLine[]) => ls.reduce((a, l) => a + lineTotals(l).netPence, 0);
  return {
    lines: per,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatByRate,
    oneOffNetPence: sumNet(oneOff),
    monthlyNetPence: sumNet(monthly),
    firstYearNetPence: sumNet(oneOff) + sumNet(monthly) * 12,
  };
}

/** Parse "£1,250.50" / "1250.5" → 125050 pence. Returns null if invalid. */
export function parsePounds(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = input.replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function poundsFromPence(p: number): number {
  return Math.round(p) / 100;
}

/** Deposit split for a proposal: deposit on the one-off fees. */
export function depositSplit(oneOffNetPence: number, depositPercent: number | null | undefined) {
  const pct = Math.min(100, Math.max(0, depositPercent ?? 0));
  const deposit = Math.round((oneOffNetPence * pct) / 100);
  return { depositPence: deposit, balancePence: oneOffNetPence - deposit };
}
