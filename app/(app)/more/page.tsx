import Link from "next/link";
import { NAV } from "@/lib/nav";

export default function MorePage() {
  return (
    <div>
      <p className="hud-label mb-3">Everything</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {NAV.map((n) => (
          <li key={n.href}>
            <Link href={n.href} className="panel flex min-h-20 flex-col justify-center gap-2 p-4">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.icon} /></svg>
              <span className="text-sm font-medium">{n.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
