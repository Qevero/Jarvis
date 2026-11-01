/** Qevero's revenue streams. Xero tracking category "Revenue Stream" options map here. */

export const STREAMS = [
  { id: "website_builds", label: "Website Builds", recurring: false, aliases: ["websites", "web build", "website build", "web design", "web"] },
  { id: "seo_geo_retainers", label: "SEO/GEO Retainers", recurring: true, aliases: ["seo", "geo", "seo retainer", "seo geo", "seo and geo", "search"] },
  { id: "paid_media", label: "Paid Media", recurring: false, aliases: ["ppc", "paid ads", "ads", "paid social", "google ads"] },
  { id: "software_hosting", label: "Software & Hosting", recurring: true, aliases: ["hosting", "software", "software and hosting", "saas", "maintenance"] },
  { id: "creative_content", label: "Creative/Content", recurring: false, aliases: ["creative", "content", "creative content", "design", "copywriting"] },
] as const;

export type StreamId = (typeof STREAMS)[number]["id"];
export const UNASSIGNED = "unassigned" as const;
export type StreamOrUnassigned = StreamId | typeof UNASSIGNED;

export const STREAM_IDS = STREAMS.map((s) => s.id) as StreamId[];
export const TRACKING_CATEGORY_NAME = "Revenue Stream";

const byId = new Map<string, (typeof STREAMS)[number]>(STREAMS.map((s) => [s.id, s]));

export function streamLabel(id: string): string {
  return byId.get(id)?.label ?? "Unassigned";
}

export function isRecurringStream(id: string): boolean {
  return byId.get(id)?.recurring ?? false;
}

export function isStreamId(id: string): id is StreamId {
  return byId.has(id);
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Match a Xero tracking option name (e.g. "SEO / GEO Retainers") to a stream. */
export function matchStreamOption(option: string | null | undefined): StreamId | null {
  if (!option) return null;
  const n = normalise(option);
  for (const s of STREAMS) {
    if (normalise(s.label) === n || normalise(s.id.replace(/_/g, " ")) === n) return s.id;
  }
  for (const s of STREAMS) {
    if (s.aliases.some((a) => normalise(a) === n)) return s.id;
  }
  return null;
}

/** Keyword suggestion for an unmapped line (shown on the mapping screen, never applied silently). */
export function suggestStream(description: string | null | undefined): StreamId | null {
  if (!description) return null;
  const n = ` ${normalise(description)} `;
  const rules: [StreamId, string[]][] = [
    ["seo_geo_retainers", ["seo", "geo", "search engine", "local search", "retainer"]],
    ["software_hosting", ["hosting", "domain", "ssl", "maintenance", "licence", "license", "software", "saas"]],
    ["paid_media", ["ppc", "google ads", "meta ads", "paid social", "ad spend", "adwords"]],
    ["website_builds", ["website", "web build", "web design", "landing page", "ecommerce", "shopify", "wordpress"]],
    ["creative_content", ["logo", "brand", "copy", "content", "photography", "video", "design"]],
  ];
  for (const [id, words] of rules) if (words.some((w) => n.includes(` ${w} `) || n.includes(` ${w}`))) return id;
  return null;
}
