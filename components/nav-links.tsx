"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV, NAV_ICONS as I, type NavItem as Item } from "@/lib/nav";

const MOBILE: Item[] = [
  NAV[0],
  { href: "/revenue", label: "Money", icon: I.revenue },
  NAV[4],
  NAV[6],
  { href: "/more", label: "More", icon: I.more },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function NavLinks({ variant }: { variant: "side" | "bottom" }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (variant === "side") {
    return (
      <ul className="space-y-0.5">
        {NAV.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={isActive(l.href) ? "page" : undefined} className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm ${isActive(l.href) ? "bg-accent/10 text-accent" : "text-muted hover:bg-white/5 hover:text-fg"}`}>
              <Icon d={l.icon} />
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  const moreActive = !MOBILE.slice(0, 4).some((m) => isActive(m.href));
  return (
    <ul className="grid grid-cols-5">
      {MOBILE.map((l) => {
        const active = l.href === "/more" ? moreActive && path !== "/" : isActive(l.href);
        return (
          <li key={l.href}>
            <Link href={l.href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${active ? "text-accent" : "text-muted"}`}>
              <Icon d={l.icon} />
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
