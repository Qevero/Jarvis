import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { coreMemories, digestConversation, forget, getConversation, KNOWLEDGE_KINDS, listConversations, memoryStats, recall, remember, searchChats } from "@/lib/services/knowledge";
import { run } from "../util";

export function registerMemoryTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "get_core_memories",
    {
      title: "Core memories",
      description: "Jarvis's pinned and most important knowledge about Jasper and Qevero (preferences, key facts, goals, decisions). Call this at the start of a substantial conversation to get context.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => ({ memories: await coreMemories(ctx), stats: await memoryStats(ctx) })),
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Save a durable piece of knowledge to Jarvis's long-term memory: a fact, preference, decision, person, client detail, process, idea, goal or lesson. Use whenever Jasper tells you something worth knowing in future chats (\"remember that…\", pricing decisions, how he likes things done, who's who). Same title updates the existing memory.",
      inputSchema: {
        title: z.string().min(1).max(300).describe("Short, specific, e.g. 'SEO retainer minimum price'"),
        content: z.string().max(20_000).optional(),
        kind: z.enum(KNOWLEDGE_KINDS).optional(),
        tags: z.array(z.string()).max(15).optional(),
        importance: z.number().int().min(1).max(5).optional().describe("5 = always relevant"),
        pinned: z.boolean().optional(),
        source_ref: z.string().max(300).optional().describe("Where it came from, e.g. a past chat title"),
      },
    },
    async (a) => run(async () => remember(ctx, { ...a, sourceRef: a.source_ref })),
  );

  server.registerTool(
    "recall",
    {
      title: "Recall",
      description: "Search Jarvis's long-term memory (full text), optionally by kind or tag.",
      inputSchema: { query: z.string().optional(), kind: z.enum(KNOWLEDGE_KINDS).optional(), tag: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(async () => recall(ctx, a)),
  );

  server.registerTool(
    "forget",
    { title: "Forget", description: "Delete a memory (only when Jasper asks).", inputSchema: { id: z.string().uuid() }, annotations: { destructiveHint: true } },
    async ({ id }) => run(async () => forget(ctx, id)),
  );

  server.registerTool(
    "search_past_chats",
    {
      title: "Search past Claude chats",
      description: "Full-text search across Jasper's imported Claude chat history (from his Claude data export). Returns matching snippets with the conversation id.",
      inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => run(async () => searchChats(ctx, query, limit ?? 15)),
  );

  server.registerTool(
    "get_past_chat",
    { title: "Read a past chat", description: "Read an imported Claude conversation (truncated if very long).", inputSchema: { id: z.string().uuid(), max_chars: z.number().int().min(1000).max(60_000).optional() }, annotations: { readOnlyHint: true } },
    async ({ id, max_chars }) => run(async () => getConversation(ctx, id, { maxChars: max_chars })),
  );

  server.registerTool(
    "list_past_chats",
    {
      title: "List past chats",
      description: "List imported Claude conversations, newest first. undigested_only=true lists chats whose knowledge hasn't been extracted yet — use this to work through history: read each, save key facts with remember, then mark it with save_chat_digest.",
      inputSchema: { undigested_only: z.boolean().optional(), title_contains: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => run(async () => listConversations(ctx, { undigestedOnly: a.undigested_only, query: a.title_contains, limit: a.limit })),
  );

  server.registerTool(
    "save_chat_digest",
    { title: "Save chat digest", description: "Record a 1–3 sentence digest of a past chat after extracting its knowledge, marking it as processed.", inputSchema: { id: z.string().uuid(), digest: z.string().min(1).max(4000) } },
    async ({ id, digest }) => run(async () => digestConversation(ctx, id, digest)),
  );
}
