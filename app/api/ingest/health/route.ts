import { ingest, readJson } from "@/lib/ingest";
import { normaliseHealthPayload } from "@/lib/health/normalise";

export const dynamic = "force-dynamic";

/** Daily health from Apple Health (MyFitnessPal, Hevy, Watch, scales) via an iPhone Shortcut. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  return ingest(request, "health", normaliseHealthPayload(body));
}
