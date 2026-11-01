import { daysBetween } from "@/lib/dates";

/**
 * Corporation tax estimate (UK, financial years from 1 April 2023): 19% small
 * profits rate up to £50,000, 25% main rate above £250,000, marginal relief in
 * between (fraction 3/200). Limits are pro-rated for short accounting periods
 * and divided by (1 + associated companies). ESTIMATE ONLY, NOT TAX ADVICE.
 */

export const CT = { smallRate: 0.19, mainRate: 0.25, lowerLimit: 50_000, upperLimit: 250_000, marginalFraction: 3 / 200 };

export type CtEstimate = {
  profit: number;
  taxableProfit: number;
  days: number;
  lowerLimit: number;
  upperLimit: number;
  band: "loss" | "small" | "marginal" | "main";
  tax: number;
  effectiveRatePct: number;
  marginalRelief: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function estimateCorporationTax(profit: number, periodStart: string, periodEnd: string, associatedCompanies = 0): CtEstimate {
  const days = daysBetween(periodStart, periodEnd) + 1;
  const factor = Math.min(days, 365) / 365 / (1 + Math.max(0, associatedCompanies));
  const lower = r2(CT.lowerLimit * factor);
  const upper = r2(CT.upperLimit * factor);
  const taxable = Math.max(0, profit);
  let tax = 0, band: CtEstimate["band"], relief = 0;
  if (taxable <= 0) band = "loss";
  else if (taxable <= lower) {
    band = "small";
    tax = taxable * CT.smallRate;
  } else if (taxable > upper) {
    band = "main";
    tax = taxable * CT.mainRate;
  } else {
    band = "marginal";
    relief = CT.marginalFraction * (upper - taxable);
    tax = taxable * CT.mainRate - relief;
  }
  return {
    profit: r2(profit),
    taxableProfit: r2(taxable),
    days,
    lowerLimit: lower,
    upperLimit: upper,
    band,
    tax: r2(tax),
    effectiveRatePct: taxable > 0 ? r2((tax / taxable) * 100) : 0,
    marginalRelief: r2(relief),
  };
}

/** Straight-line projection of year-to-date profit to the full accounting period. */
export function projectProfit(profitToDate: number, periodStart: string, periodEnd: string, today: string): number {
  const elapsed = Math.max(1, daysBetween(periodStart, today) + 1);
  const total = daysBetween(periodStart, periodEnd) + 1;
  return r2((profitToDate / elapsed) * total);
}

export const TAX_DISCLAIMER = "Estimate only — not tax advice. Confirm figures with your accountant before relying on them.";
