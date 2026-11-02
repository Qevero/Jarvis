"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, NAV_ICONS } from "@/lib/nav";
import { openPalette } from "@/components/command-palette";

export function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const BUSINESS = ["/business", "/revenue", "/invoices", "/proposals", "/crm", "/clients", "/tax", "/vault", "/print"];
const LIFE = ["/life", "/work", "/health", "/messages", "/journal", "/memory", "/review"];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
}

export function SideNav({ inboxCount }: { inboxCount: number }) {
  const isActive = useActive();
  return (
    <div className="space-y-5">
      <button type="button" onClick={openPalette} className="flex w-full items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-sm text-muted hover:border-line-strong">
        <Icon d={NAV_ICONS.search} className="h-4 w-4" /> Search or jump to…
        <kbd className="ml-auto rounded border border-line px-1.5 text-[10px]">⌘K</kbd>
      </button>
      {NAV_GROUPS.map((g) => (
        <div key={g.title || "top"}>
          {g.title && <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted/80">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={isActive(l.href) ? "page" : undefined} className={`flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${isActive(l.href) ? "bg-accent/12 font-medium text-fg" : "text-muted hover:bg-white/[0.04] hover:text-fg"}`}>
                  <span className={isActive(l.href) ? "text-accent" : ""}><Icon d={l.icon} /></span>
                  {l.label}
                  {l.href === "/inbox" && inboxCount > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-[#031018]">{inboxCount}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/", label: "Today", icon: NAV_ICONS.home, active: path === "/" },
    { href: "/business", label: "Business", icon: NAV_ICONS.business, active: BUSINESS.some((p) => path.startsWith(p)) },
    { href: "/life", label: "Life", icon: NAV_ICONS.life, active: LIFE.some((p) => path.startsWith(p)) },
    { href: "/inbox", label: "Inbox", icon: NAV_ICONS.inbox, active: path.startsWith("/inbox"), badge: inboxCount },
  ];
  return (
    <ul className="grid grid-cols-5">
      {tabs.map((t) => (
        <li key={t.href}>
          <Link href={t.href} className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] ${t.active ? "text-accent" : "text-muted"}`}>
            <Icon d={t.icon} className="h-6 w-6" />
            {t.label}
            {t.badge ? <span className="absolute right-[22%] top-2 rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-[#031018]">{t.badge}</span> : null}
          </Link>
        </li>
      ))}
      <li>
        <button type="button" onClick={openPalette} className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] text-muted">
          <Icon d={NAV_ICONS.search} className="h-6 w-6" />
          Search
        </button>
      </li>
    </ul>
  );
}
