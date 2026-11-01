/** Jarvis mark: concentric HUD arcs around a core. Original artwork. */
export function HudMark({ className = "h-8 w-8", spin = false }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <g className={spin ? "hud-spin" : undefined}>
        <path d="M32 6 A26 26 0 0 1 58 32" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <path d="M32 58 A26 26 0 0 1 6 32" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      </g>
      <circle cx="32" cy="32" r="17" fill="none" stroke="var(--accent-dim)" strokeWidth="1.5" strokeDasharray="3 4" />
      <circle cx="32" cy="32" r="8" fill="var(--accent)" opacity="0.9" />
      <circle cx="32" cy="32" r="12" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}
