import { describe, expect, it } from "vitest";
import { daysBetween, formatGbpFromPence, formatUkDate, formatUkDateTime, parseDate, parseDayMonth, todayUk } from "@/lib/dates";

describe("parseDate", () => {
  it("accepts UK and ISO formats", () => {
    expect(parseDate("03/10/2026")).toBe("2026-10-03");
    expect(parseDate("3/10/2026")).toBe("2026-10-03");
    expect(parseDate("2026-10-03")).toBe("2026-10-03");
  });
  it("reads DD/MM, not MM/DD", () => {
    expect(parseDate("10/03/2026")).toBe("2026-03-10");
    expect(parseDate("31/10/2026")).toBe("2026-10-31");
    expect(parseDate("10/31/2026")).toBeNull();
  });
  it("rejects impossible dates", () => {
    expect(parseDate("31/09/2026")).toBeNull();
    expect(parseDate("29/02/2027")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
    expect(parseDate("tomorrow")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats ISO dates as DD/MM/YYYY", () => {
    expect(formatUkDate("2026-10-03")).toBe("03/10/2026");
    expect(formatUkDate(null)).toBe("");
  });
  it("shows timestamps in UK time (GMT/BST)", () => {
    // 23:30 UTC on 30/06 is 00:30 BST on 01/07.
    expect(formatUkDate("2026-06-30T23:30:00Z")).toBe("01/07/2026");
    expect(formatUkDateTime("2026-06-30T23:30:00Z")).toBe("01/07/2026, 00:30");
    // Winter: GMT = UTC.
    expect(formatUkDate("2026-12-31T23:30:00Z")).toBe("31/12/2026");
  });
  it("formats GBP", () => {
    expect(formatGbpFromPence(123456)).toBe("£1,234.56");
    expect(formatGbpFromPence(null)).toBe("");
  });
});

describe("parseDayMonth", () => {
  it("normalises year-end style dates", () => {
    expect(parseDayMonth("31/10")).toBe("31/10");
    expect(parseDayMonth("1/4")).toBe("01/04");
    expect(parseDayMonth("29/02")).toBe("29/02");
    expect(parseDayMonth("31/11")).toBeNull();
    expect(parseDayMonth("October")).toBeNull();
  });
});

describe("todayUk / daysBetween", () => {
  it("uses the UK calendar day", () => {
    expect(todayUk(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(todayUk(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-01");
  });
  it("counts whole days across the clocks changing", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-10-31")).toBe(-1);
  });
});
