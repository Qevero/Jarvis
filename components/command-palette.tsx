"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV } from "@/lib/nav";

/** ⌘K / Ctrl+K command palette: jump to any page or search everything in Jarvis. */

type Hit = { group: string; title: string; sub?: string; href: string };

export function openPalette() {
  window.dispatchEvent(new Event("jarvis:palette"));
}

const QUICK: Hit[] = [
  { group: "Do", title: "Ask Jarvis in Claude", href: "https://claude.ai/new" },
  { group: "Do", title: "New invoice", href: "/invoices?tab=new" },
  { group: "Do", title: "New proposal", href: "/proposals/new" },
  { group: "Do", title: "Log weight or food", href: "/health#log" },
  { group: "Do", title: "Daily check-in", href: "/life#checkin" },
  { group: "Do", title: "Write in journal", href: "/journal" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ term: string; hits: Hit[] }>({ term: "", hits: [] });
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("jarvis:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("jarvis:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
  }, [open]);

  const term = q.trim();
  const local = useMemo<Hit[]>(() => {
    const all = [...QUICK, ...NAV.map((n) => ({ group: "Go to", title: n.label, href: n.href }))];
    return term ? all.filter((h) => h.title.toLowerCase().includes(term.toLowerCase())) : all;
  }, [term]);
  const hits = useMemo<Hit[]>(() => [...local, ...(remote.term === term ? remote.hits : [])], [local, remote, term]);

  useEffect(() => {
    if (!open || term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { results: Hit[] };
        setRemote({ term, hits: body.results.filter((r) => r.group !== "Go to") });
      } catch {
        // aborted or offline
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term, open]);

  if (!open) return null;

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    if (h.href.startsWith("http")) window.open(h.href, "_blank", "noopener");
    else router.push(h.href);
  };

  const groups = [...new Set(hits.map((h) => h.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-3 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Search Jarvis">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-bg-elev shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && hits[sel]) go(hits[sel]);
          }}
          placeholder="Search clients, invoices, journal, memories… or jump to a page"
          className="w-full border-b border-line bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted"
        />
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing found.</p>}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{g}</p>
              {hits.map((h, i) => (h.group === g ? (
                <button key={`${g}${i}`} type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)} className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${i === sel ? "bg-accent/12 text-fg" : "text-fg/90"}`}>
                  <span className="truncate">{h.title}</span>
                  {h.sub && <span className="shrink-0 text-xs text-muted">{h.sub}</span>}
                </button>
              ) : null))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
