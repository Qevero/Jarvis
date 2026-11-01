"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home", icon: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/vault", label: "Vault", icon: "M4 5h16v14H4zM4 9h16M9 13h6" },
  { href: "/settings", label: "Settings", icon: "M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4" },
];

export function NavLinks({ variant }: { variant: "top" | "bottom" }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (variant === "top") {
    return (
      <ul className="flex gap-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={`btn btn-sm ${isActive(l.href) ? "border-accent text-accent" : "btn-ghost border-transparent"}`}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-3">
      {LINKS.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${isActive(l.href) ? "text-accent" : "text-muted"}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={l.icon} />
            </svg>
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
