import { looksLikeWhatsApp } from "./whatsapp";

/** Decides what something shared to Jarvis is: a WhatsApp chat export, a link, or a note. */
export function classifyCapture(text: string, name?: string | null): { kind: "whatsapp" | "link" | "note"; url: string | null; title: string } {
  const t = text.trim();
  if (looksLikeWhatsApp(t)) return { kind: "whatsapp", url: null, title: name ?? "WhatsApp chat" };
  const single = /^(https?:\/\/\S+)$/i.exec(t);
  if (single) {
    let title = single[1];
    try {
      const u = new URL(single[1]);
      title = `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : ""}`.slice(0, 120);
    } catch {
      // keep raw
    }
    return { kind: "link", url: single[1], title };
  }
  const firstUrl = /(https?:\/\/\S+)/i.exec(t)?.[1] ?? null;
  const firstLine = t.split("\n").find((l) => l.trim())?.trim() ?? "Note";
  return { kind: firstUrl && t.length < 400 ? "link" : "note", url: firstUrl, title: firstLine.slice(0, 120) };
}
