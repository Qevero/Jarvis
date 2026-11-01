import { dashboardCtx } from "@/lib/dashboard-ctx";
import { audit } from "@/lib/ctx";
import { blogDraftMarkdown, slugify } from "@/lib/journal/format";
import { getJournalEntry } from "@/lib/services/journal";

export const dynamic = "force-dynamic";

/** "Turn into blog draft": downloads a Markdown draft for qevero.com. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await dashboardCtx("/journal");
  const entry = await getJournalEntry(ctx, id);
  const md = blogDraftMarkdown(entry, { includeClients: new URL(req.url).searchParams.get("clients") === "1" });
  await audit(ctx, "journal.blog_export", id);
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${slugify(entry.title)}.md"`, "Cache-Control": "no-store" } });
}
