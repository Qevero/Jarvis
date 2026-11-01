import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/mcp/tools/outlook";

describe("calendar ranges (UK weeks start Monday)", () => {
  const wed = "2026-11-04";
  it("resolves named ranges", () => {
    expect(resolveRange("today", undefined, undefined, wed)).toEqual({ start: wed, end: wed });
    expect(resolveRange("tomorrow", undefined, undefined, wed)).toEqual({ start: "2026-11-05", end: "2026-11-05" });
    expect(resolveRange("this_week", undefined, undefined, wed)).toEqual({ start: wed, end: "2026-11-08" });
    expect(resolveRange("next_week", undefined, undefined, wed)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(resolveRange("next_week", undefined, undefined, "2026-11-08")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });
  it("accepts explicit UK dates", () => {
    expect(resolveRange(undefined, "06/11/2026", "07/11/2026")).toEqual({ start: "2026-11-06", end: "2026-11-07" });
    expect(() => resolveRange(undefined, "11/31/2026")).toThrow();
  });
});
