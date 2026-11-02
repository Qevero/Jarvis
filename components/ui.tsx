import Link from "next/link";

export function PageHeader({ label, title, children, sub }: { label: string; title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="hud-label">{label}</p>
        <h1 className="mt-1.5 text-[1.7rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>}
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
      <p className={`num mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</p>
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

/** Big tappable tile with a headline number (hub pages). */
export function Tile({ href, label, value, sub, icon, tone, progress }: { href: string; label: string; value: string; sub?: string; icon?: string; tone?: "ok" | "warn" | "danger"; progress?: number | null }) {
  const toneClass = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
  return (
    <Link href={href} className="tile fade-in">
      <span className="flex items-center justify-between">
        <span className="hud-label">{label}</span>
        {icon && <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent/80" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>}
      </span>
      <span className={`num mt-auto text-[1.6rem] font-semibold leading-none ${toneClass}`}>{value}</span>
      {progress !== undefined && progress !== null && <span className="bar mt-1" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }} /></span>}
      {sub && <span className="text-xs leading-snug text-muted">{sub}</span>}
    </Link>
  );
}

/** Labelled progress towards a target. */
export function Progress({ label, value, target, unit = "", invert = false }: { label: string; value: number | null; target: number | null; unit?: string; invert?: boolean }) {
  const p = value !== null && target ? value / target : null;
  const good = p === null ? false : invert ? p <= 1.05 : p >= 0.95;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="num">{value === null ? "—" : `${Math.round(value).toLocaleString("en-GB")}${unit}`}{target ? <span className="text-muted"> / {target.toLocaleString("en-GB")}{unit}</span> : null}</span>
      </div>
      <div className="bar mt-1.5"><span style={{ width: `${p === null ? 0 : Math.min(100, p * 100)}%`, background: p === null ? undefined : good ? "var(--ok)" : "var(--accent)" }} /></div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between first:mt-0">
      <h2 className="text-[0.95rem] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
