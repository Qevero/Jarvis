import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { checkinData, gatherWeeklyReview, listCaptures, saveCheckin, setCaptureStatus } from "@/lib/services/labs";
import { run } from "../util";

/** Labs: Inbox (things shared from the iPhone), daily check-in, weekly review. */
export function registerLabsTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "get_inbox",
    { title: "Jarvis Inbox", description: "Things Jasper shared to Jarvis from his iPhone share sheet (notes, links, WhatsApp chat imports) that aren't dealt with yet. Help him triage: summarise, turn into tasks, journal entries or memories, then mark done.", inputSchema: { include_done: z.boolean().optional() }, annotations: { readOnlyHint: true } },
    async ({ include_done }) => run(async () => (await listCaptures(ctx, { status: include_done ? "all" : "new", limit: 50 })).map((c) => ({ ...c, text: c.text && c.text.length > 4000 ? `${c.text.slice(0, 4000)}…` : c.text }))),
  );
  server.registerTool(
    "mark_capture_done",
    { title: "Mark Inbox item done", description: "Mark an Inbox item as dealt with.", inputSchema: { id: z.string().uuid() } },
    async ({ id }) => run(async () => {
      await setCaptureStatus(ctx, id, "done");
      return { done: id };
    }),
  );
  server.registerTool(
    "save_checkin",
    { title: "Daily check-in", description: "Record how Jasper feels today on 1–5 scales (mood, energy, sleep quality, stress) plus an optional note — e.g. when he says 'I'm knackered, slept badly'. Ask for any missing scores briefly.", inputSchema: { mood: z.number().int().min(1).max(5).optional(), energy: z.number().int().min(1).max(5).optional(), sleep: z.number().int().min(1).max(5).optional(), stress: z.number().int().min(1).max(5).optional(), note: z.string().max(2000).optional() } },
    async (a) => run(async () => saveCheckin(ctx, a)),
  );
  server.registerTool(
    "get_checkins",
    { title: "Check-in trends", description: "Recent daily check-ins, 7-day averages and simple patterns (e.g. mood on training vs rest days, energy after good vs poor sleep).", inputSchema: { days: z.number().int().min(7).max(90).optional() }, annotations: { readOnlyHint: true } },
    async ({ days }) => run(async () => checkinData(ctx, days ?? 30)),
  );
  server.registerTool(
    "get_weekly_review",
    { title: "Weekly review", description: "This week (Mon–Sun) across business and life: revenue vs last week, invoices, proposals, training and PRs, nutrition and weight, check-ins, journal themes, deadlines ahead — with wins, things to watch and reflection prompts. Good for a Sunday chat; offer to save reflections to the journal.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => run(async () => {
      const r = await gatherWeeklyReview(ctx);
      return { spoken: r.spoken, wins: r.wins, watch: r.watch, sections: r.sections, prompts: r.prompts };
    }),
  );
}
