import { describe, expect, it } from "vitest";
import { addMonths, financialYear, fyStartMonthFromYearEnd, lastMonths, monthRange, quarterOf, resolvePeriod } from "@/lib/periods";
import { agedDebtors, averageDealSize, bucketFor, buildRevenueLines, clientBreakdown, growth, latePayers, monthlySeries, recurringRunRate, revenueByStream, totalRevenue } from "@/lib/revenue/analytics";
import { attentionFlags } from "@/lib/revenue/flags";
import { matchStreamOption, suggestStream } from "@/lib/revenue/streams";
import { DEFAULT_PREFS, mergePrefs } from "@/lib/settings-defaults";
import { invoice, line, sale } from "./fixtures";

function build(items: ReturnType<typeof sale>[], accountMap = {}, overrides = {}) {
  const invoices = items.map((i) => i.inv);
  const lines = items.flatMap((i) => i.lines);
  return { invoices, lines, rev: buildRevenueLines(invoices, lines, accountMap, overrides) };
}

describe("periods", () => {
  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-31");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("knows Qevero's financial year (1 Nov – 31 Oct)", () => {
    expect(fyStartMonthFromYearEnd("31/10")).toBe(11);
    expect(financialYear("2026-11-01", 11)).toEqual({ start: "2026-11-01", end: "2027-10-31" });
    expect(financialYear("2027-10-31", 11)).toEqual({ start: "2026-11-01", end: "2027-10-31" });
  });
  it("uses calendar quarters (same as the VAT quarters)", () => {
    expect(quarterOf("2026-11-15")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(resolvePeriod("last_quarter", "2027-02-10")).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
    expect(resolvePeriod("ytd", "2027-02-10")).toMatchObject({ start: "2026-11-01", end: "2027-02-10" });
    expect(resolvePeriod("last_month", "2027-01-15")).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
  });
  it("lists months", () => {
    expect(monthRange("2026-11-20", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(lastMonths("2027-02-10", 3)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
});

describe("streams", () => {
  it("matches tracking options flexibly", () => {
    expect(matchStreamOption("SEO/GEO Retainers")).toBe("seo_geo_retainers");
    expect(matchStreamOption("seo / geo retainers")).toBe("seo_geo_retainers");
    expect(matchStreamOption("Software & Hosting")).toBe("software_hosting");
    expect(matchStreamOption("Hosting")).toBe("software_hosting");
    expect(matchStreamOption("Something else")).toBeNull();
  });
  it("suggests streams from descriptions", () => {
    expect(suggestStream("Monthly SEO retainer – November")).toBe("seo_geo_retainers");
    expect(suggestStream("Website hosting and SSL")).toBe("software_hosting");
    expect(suggestStream("New WordPress website build")).toBe("website_builds");
    expect(suggestStream("Lunch")).toBeNull();
  });
});

describe("revenue lines", () => {
  it("counts only posted sales, nets credit notes and converts currency", () => {
    const a = sale("2026-11-05", 1000, "Website Builds");
    const draft = sale("2026-11-06", 500, "Website Builds", { status: "DRAFT" });
    const voided = sale("2026-11-06", 500, "Website Builds", { status: "VOIDED" });
    const credit = sale("2026-11-10", 200, "Website Builds", { type: "ACCRECCREDIT" });
    const usd = sale("2026-11-12", 130, "Paid Media", { currency_rate: 1.3 });
    const bill = sale("2026-11-12", 300, null, { type: "ACCPAY" });
    const { rev } = build([a, draft, voided, credit, usd, bill]);
    expect(rev.map((r) => r.net)).toEqual([1000, -200, 100]);
    expect(totalRevenue(rev, "2026-11-01", "2026-11-30")).toBe(900);
  });

  it("resolves streams: override → tracking → account map → unassigned", () => {
    const t = sale("2026-11-01", 100, "Paid Media");
    const acc = sale("2026-11-02", 100, null);
    acc.lines[0].account_code = "260";
    const none = sale("2026-11-03", 100, null);
    none.lines[0].account_code = "999";
    const over = sale("2026-11-04", 100, "Paid Media");
    const key = `${over.inv.invoice_id}:${over.lines[0].line_item_id}`;
    const { rev } = build([t, acc, none, over], { "260": "software_hosting" }, { [key]: "creative_content" });
    expect(rev.map((r) => [r.stream, r.streamSource])).toEqual([
      ["paid_media", "tracking"],
      ["software_hosting", "account"],
      ["unassigned", "none"],
      ["creative_content", "override"],
    ]);
  });

  it("splits revenue by stream with shares", () => {
    const { rev } = build([sale("2026-11-01", 3000, "Website Builds"), sale("2026-11-02", 1000, "SEO/GEO Retainers")]);
    const r = revenueByStream(rev, "2026-11-01", "2026-11-30");
    expect(r.total).toBe(4000);
    expect(r.streams.find((s) => s.stream === "website_builds")).toMatchObject({ net: 3000, share: 75 });
    expect(r.streams.find((s) => s.stream === "seo_geo_retainers")).toMatchObject({ net: 1000, share: 25, recurring: true });
    expect(r.streams.find((s) => s.stream === "unassigned")).toBeUndefined();
  });

  it("separates recurring and one-off by month (recurring streams or repeating invoices)", () => {
    const { rev } = build([
      sale("2026-11-01", 750, "SEO/GEO Retainers"),
      sale("2026-11-02", 2000, "Website Builds"),
      sale("2026-11-03", 300, "Creative/Content", { repeating_invoice_id: "rep-1" }),
      sale("2026-12-01", 750, "SEO/GEO Retainers"),
    ]);
    const s = monthlySeries(rev, ["2026-11", "2026-12"]);
    expect(s).toEqual([
      { month: "2026-11", net: 3050, recurring: 1050, oneOff: 2000 },
      { month: "2026-12", net: 750, recurring: 750, oneOff: 0 },
    ]);
    expect(recurringRunRate(rev, "2027-01-10")).toEqual({ month: "2026-12", mrr: 750, arr: 9000 });
  });

  it("computes growth vs last month and trailing average, and projects the month", () => {
    const series = [
      { month: "2026-08", net: 1000, recurring: 0, oneOff: 1000 },
      { month: "2026-09", net: 2000, recurring: 0, oneOff: 2000 },
      { month: "2026-10", net: 3000, recurring: 0, oneOff: 3000 },
      { month: "2026-11", net: 1500, recurring: 0, oneOff: 1500 },
      { month: "2026-12", net: 500, recurring: 0, oneOff: 500 },
    ];
    const g = growth(series, "2026-12-10");
    expect(g.lastComplete?.month).toBe("2026-11");
    expect(g.momPct).toBe(-50);
    expect(g.trailing3Avg).toBe(2000);
    expect(g.vsTrailingPct).toBe(-25);
    expect(g.projectedMonth).toBe(1550);
  });

  it("measures client concentration", () => {
    const { rev } = build([
      sale("2026-11-01", 6000, "Website Builds", { contact_id: "a", contact_name: "World of Beds" }),
      sale("2026-11-02", 2000, "Paid Media", { contact_id: "b", contact_name: "B" }),
      sale("2026-11-03", 1000, "Paid Media", { contact_id: "c", contact_name: "C" }),
      sale("2026-11-04", 1000, "Paid Media", { contact_id: "d", contact_name: "D" }),
    ]);
    const cb = clientBreakdown(rev, "2026-11-01", "2026-11-30");
    expect(cb).toMatchObject({ total: 10000, clientCount: 4, top1Share: 60, top3Share: 90 });
    expect(cb.clients[0]).toMatchObject({ name: "World of Beds", share: 60, invoices: 1 });
  });

  it("averages deal size per stream per invoice", () => {
    const multi = invoice({ date: "2026-11-01" });
    const lines = [line(multi.invoice_id, 1000, { stream_option: "Website Builds" }), line(multi.invoice_id, 500, { stream_option: "Website Builds" })];
    const other = sale("2026-11-05", 3000, "Website Builds");
    const rev = buildRevenueLines([multi, other.inv], [...lines, ...other.lines]);
    const web = averageDealSize(rev, "2026-11-01", "2026-11-30").find((s) => s.stream === "website_builds")!;
    expect(web).toMatchObject({ invoices: 2, total: 4500, average: 2250 });
  });
});

describe("debtors", () => {
  const today = "2026-12-31";
  const invoices = [
    invoice({ date: "2026-12-20", due_date: "2027-01-03", amount_due: 100 }),
    invoice({ date: "2026-11-01", due_date: "2026-11-15", amount_due: 200, contact_name: "Slow Ltd", contact_id: "slow" }),
    invoice({ date: "2026-08-01", due_date: "2026-08-15", amount_due: 300 }),
    invoice({ date: "2026-08-01", due_date: "2026-08-15", amount_due: 0, status: "PAID", fully_paid_on: "2026-09-14", contact_id: "slow", contact_name: "Slow Ltd" }),
    invoice({ date: "2026-08-01", due_date: "2026-08-15", amount_due: 999, status: "DRAFT" }),
  ];
  it("buckets by days overdue", () => {
    expect([0, 1, 30, 31, 61, 91].map(bucketFor)).toEqual(["current", "1-30", "1-30", "31-60", "61-90", "90+"]);
    const a = agedDebtors(invoices, today);
    expect(a.total).toBe(600);
    expect(a.overdue).toBe(500);
    expect(a.buckets).toEqual({ current: 100, "1-30": 0, "31-60": 200, "61-90": 0, "90+": 300 });
    expect(a.items[0].daysOverdue).toBe(138);
  });
  it("finds late payers", () => {
    expect(latePayers(invoices)).toEqual([{ contactId: "slow", name: "Slow Ltd", invoices: 1, averageDaysLate: 30, paidLate: 1 }]);
  });
});

describe("attention flags", () => {
  const prefs = DEFAULT_PREFS;
  it("flags a stream that dropped vs its trailing average", () => {
    const items = [
      sale("2026-08-10", 2000, "Website Builds"),
      sale("2026-09-10", 2000, "Website Builds"),
      sale("2026-10-10", 2000, "Website Builds"),
      sale("2026-11-10", 500, "Website Builds"),
    ];
    const { rev, invoices } = build(items);
    const flags = attentionFlags({ lines: rev, invoices: invoices.map((i) => ({ ...i, status: "PAID" })), today: "2026-12-03", prefs });
    const f = flags.find((x) => x.rule === "stream_drop")!;
    expect(f.title).toBe("Website Builds down 75%");
    expect(f.severity).toBe("high");
  });

  it("flags overdue invoices, stale drafts and bills due", () => {
    const invoices = [
      invoice({ date: "2026-10-01", due_date: "2026-10-15", amount_due: 1200, contact_name: "World of Beds" }),
      invoice({ date: "2026-11-20", status: "DRAFT", total: 600 }),
      invoice({ type: "ACCPAY", date: "2026-11-25", due_date: "2026-12-05", amount_due: 90, contact_name: "Hosting Co" }),
    ];
    const flags = attentionFlags({ lines: [], invoices, today: "2026-12-01", prefs });
    expect(flags.map((f) => f.rule)).toEqual(["overdue_invoices", "stale_drafts", "bills_due"]);
    expect(flags[0]).toMatchObject({ severity: "high", title: "1 overdue invoice (£1,200.00)" });
  });

  it("flags concentration above thresholds", () => {
    const { rev, invoices } = build([
      sale("2026-11-01", 9000, "Website Builds", { contact_id: "a", contact_name: "Big Client", status: "PAID" }),
      sale("2026-11-02", 1000, "Paid Media", { contact_id: "b", contact_name: "Small", status: "PAID" }),
    ]);
    const flags = attentionFlags({ lines: rev, invoices, today: "2026-11-20", prefs });
    expect(flags.find((f) => f.rule === "concentration")?.title).toBe("Big Client is 90% of revenue");
  });

  it("flags a retainer not yet invoiced this month (detected or configured)", () => {
    const { rev, invoices } = build([
      sale("2026-10-01", 750, "SEO/GEO Retainers", { contact_id: "wob", contact_name: "World of Beds", status: "PAID" }),
      sale("2026-11-01", 750, "SEO/GEO Retainers", { contact_id: "wob", contact_name: "World of Beds", status: "PAID" }),
    ]);
    const early = attentionFlags({ lines: rev, invoices, today: "2026-12-05", prefs });
    expect(early.find((f) => f.rule === "retainer_not_invoiced")).toBeUndefined();
    const late = attentionFlags({ lines: rev, invoices, today: "2026-12-08", prefs, retainers: [{ name: "Configured Co", xeroContactId: "cfg", monthlyPence: 50000 }] });
    expect(late.filter((f) => f.rule === "retainer_not_invoiced").map((f) => f.data?.client).sort()).toEqual(["Configured Co", "World of Beds"]);
    const invoiced = attentionFlags({ lines: rev, invoices: [...invoices, invoice({ date: "2026-12-01", contact_id: "wob", status: "DRAFT" })], today: "2026-12-08", prefs });
    expect(invoiced.find((f) => f.rule === "retainer_not_invoiced")).toBeUndefined();
  });

  it("flags untagged revenue and proposals needing follow-up", () => {
    const { rev, invoices } = build([sale("2026-11-10", 400, null, { status: "PAID" })]);
    const flags = attentionFlags({
      lines: rev,
      invoices,
      today: "2026-11-30",
      prefs,
      proposals: [{ number: "QP-0003", title: "Rebuild", client_name: "World of Beds", status: "sent", sent_at: "2026-11-10T09:00:00Z", valid_until: "2026-12-10" }],
    });
    expect(flags.map((f) => f.rule).sort()).toEqual(["proposal_follow_up", "unassigned_revenue"]);
  });
});

describe("prefs", () => {
  it("merges stored prefs over defaults, ignoring junk", () => {
    expect(mergePrefs({ overdueDays: 14, streamDropPct: "x", nope: 1 })).toEqual({ ...DEFAULT_PREFS, overdueDays: 14 });
    expect(mergePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});
