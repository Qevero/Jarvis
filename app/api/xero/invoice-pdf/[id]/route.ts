import { dashboardCtx } from "@/lib/dashboard-ctx";
import { invoicePdf } from "@/lib/xero/actions";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await dashboardCtx("/invoices");
  try {
    const pdf = await invoicePdf(ctx, id);
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invoice-${id.slice(0, 8)}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Couldn't fetch PDF", { status: 502 });
  }
}
