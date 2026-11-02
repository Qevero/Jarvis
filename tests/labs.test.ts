import { describe, expect, it } from "vitest";
import { classifyCapture } from "@/lib/capture/classify";
import { chatNameFromFilename, londonToIso, looksLikeWhatsApp, parseWhatsAppExport } from "@/lib/capture/whatsapp";
import { checkinAverages, checkinInsights } from "@/lib/checkin/insights";
import { composeWeeklyReview } from "@/lib/review/weekly";

const IOS_EXPORT = `[01/11/2026, 18:02:11] 5-a-side: ‎Messages and calls are end-to-end encrypted.
[02/11/2026, 07:30:12] Dan Smith: Game moved to 7pm
tomorrow, same pitch
[02/11/2026, 07:31:40] Jasper Sayer: I'm in
[02/11/2026, 07:35:02] Sam: ‎image omitted
[02/11/2026, 07:36:00] Sam: Can't make it sorry`;

const ANDROID_EXPORT = `02/11/2026, 09:15 - Mum: Are you coming Sunday?
02/11/2026, 09:16 - Mum: Bring the dog`;

describe("WhatsApp export parsing", () => {
  it("converts UK local times to UTC across GMT/BST", () => {
    expect(londonToIso(2026, 11, 2, 7, 30)).toBe("2026-11-02T07:30:00.000Z");
    expect(londonToIso(2026, 7, 1, 7, 30)).toBe("2026-07-01T06:30:00.000Z");
  });
  it("parses iPhone exports, multi-line messages, skips my messages, media and system lines", () => {
    const r = parseWhatsAppExport(IOS_EXPORT, { myName: "Jasper" });
    expect(r.messages).toEqual([
      { sender: "Dan Smith", sent_at: "2026-11-02T07:30:12.000Z", text: "Game moved to 7pm\ntomorrow, same pitch" },
      { sender: "Sam", sent_at: "2026-11-02T07:36:00.000Z", text: "Can't make it sorry" },
    ]);
    expect(r.isGroup).toBe(true);
  });
  it("parses Android exports and filters by date", () => {
    const r = parseWhatsAppExport(ANDROID_EXPORT, { since: "2026-11-02T09:15:30Z" });
    expect(r.messages.map((m) => m.text)).toEqual(["Bring the dog"]);
    expect(r.isGroup).toBe(false);
  });
  it("detects exports and chat names", () => {
    expect(looksLikeWhatsApp(IOS_EXPORT)).toBe(true);
    expect(looksLikeWhatsApp("just a note\nwith two lines")).toBe(false);
    expect(chatNameFromFilename("WhatsApp Chat - 5-a-side.zip")).toBe("5-a-side");
    expect(chatNameFromFilename("WhatsApp Chat with Mum.txt")).toBe("Mum");
  });
});

describe("capture classification", () => {
  it("recognises links, WhatsApp chats and notes", () => {
    expect(classifyCapture("https://www.bbc.co.uk/news/business-123")).toEqual({ kind: "link", url: "https://www.bbc.co.uk/news/business-123", title: "bbc.co.uk/news/business-123" });
    expect(classifyCapture(ANDROID_EXPORT, "Mum").kind).toBe("whatsapp");
    expect(classifyCapture("Idea: bundle hosting with SEO\nfor trades")).toMatchObject({ kind: "note", title: "Idea: bundle hosting with SEO" });
  });
});

describe("check-in insights", () => {
  const cs = [
    { day: "2026-11-01", mood: 4, energy: 4, sleep: 4, stress: 2 },
    { day: "2026-11-02", mood: 4, energy: 5, sleep: 5, stress: 2 },
    { day: "2026-11-03", mood: 5, energy: 4, sleep: 4, stress: 1 },
    { day: "2026-11-04", mood: 2, energy: 2, sleep: 2, stress: 4 },
    { day: "2026-11-05", mood: 3, energy: 2, sleep: 1, stress: 5 },
    { day: "2026-11-06", mood: 2, energy: 2, sleep: 2, stress: 4 },
  ];
  it("averages and compares only with enough days each side", () => {
    expect(checkinAverages(cs)).toMatchObject({ days: 6, mood: 3.3, energy: 3.2 });
    const ins = checkinInsights(cs, new Set(["2026-11-01", "2026-11-02", "2026-11-03"]));
    expect(ins).toContain("Training: mood averages 4.3/5 on training days vs 2.3/5 on rest days.");
    expect(ins).toContain("Sleep: energy averages 4.3/5 after good sleep vs 2/5 after poor sleep.");
    expect(checkinInsights(cs.slice(0, 2), new Set())).toEqual([]);
  });
});

describe("weekly review", () => {
  it("summarises wins and things to watch", () => {
    const r = composeWeeklyReview({
      weekStart: "2026-11-02", weekEnd: "2026-11-08",
      revenue: { thisWeek: 4500, lastWeek: 3000, invoicesRaised: 3, invoicesPaid: 2, overdue: 750 },
      training: { sessions: 3, lastWeekSessions: 4, volumeKg: 21000, lastWeekVolumeKg: 20000, prs: ["Bench 100 kg × 3"] },
      nutrition: { avgKcal: 2150, avgProtein: 165, daysLogged: 6, kcalTarget: 2200, proteinTarget: 160 },
    });
    expect(r.wins).toEqual(["Revenue up on last week", "1 personal record", "Protein target hit on average"]);
    expect(r.watch).toEqual(["£750.00 overdue — chase on Monday", "Fewer gym sessions than last week"]);
    expect(r.sections.find((s) => s.id === "business")?.lines[0]).toBe("Revenue invoiced: £4,500.00 (+50% vs last week).");
    expect(r.spoken).toMatch(/^Here's your week, 02\/11\/2026 to 08\/11\/2026\./);
  });
});
