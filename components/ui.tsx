import Link from "next/link";

export function PageHeader({ label, title, children, sub }: { label: string; title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="hud-label">{label}</p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="hud-label">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "danger" }) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
  return (
    <div className="panel p-4">
      <p className="hud-label">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
      {children}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ConnectPrompt({ what, href = "/settings" }: { what: string; href?: string }) {
  return (
    <Empty action={<Link href={href} className="btn btn-primary btn-sm">Open Settings</Link>}>
      {what} isn&apos;t connected yet. Connect it in Settings → Integrations.
    </Empty>
  );
}

const SEV: Record<string, string> = { high: "border-danger/60 text-danger", medium: "border-warn/60 text-warn", low: "border-line-strong text-muted" };
const SEV_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export function FlagList({ flags }: { flags: { id: string; severity: string; title: string; detail: string }[] }) {
  if (!flags.length) return <p className="text-sm text-muted">Nothing needs attention. ✓</p>;
  return (
    <ul className="divide-y divide-line">
      {flags.map((f) => (
        <li key={f.id} className="flex gap-3 py-3">
          <span className={`badge h-fit shrink-0 ${SEV[f.severity]}`}>
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true"><path d={f.severity === "high" ? "M6 1 11 10H1z" : f.severity === "medium" ? "M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1z" : "M2 6h8"} fill="currentColor" /></svg>
            {SEV_LABEL[f.severity]}
          </span>
          <div>
            <p className="text-sm font-medium">{f.title}</p>
            <p className="text-xs text-muted">{f.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Tabs({ tabs, active }: { tabs: { id: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} className={`-mb-px flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm ${t.id === active ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
          {t.label}
          {t.count !== undefined && <span className="badge">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function UnverifiedBadge({ verified }: { verified: boolean }) {
  return verified ? <span className="badge border-ok/50 text-ok">✓ Verified</span> : <span className="badge border-warn/60 text-warn">! Unverified</span>;
}
