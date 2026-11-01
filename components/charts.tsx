"use client";
import { useState } from "react";

/**
 * Small SVG charts in the dataviz method: thin bars with 4px rounded data ends
 * on the baseline, 2px surface gaps between stacked segments, a legend for 2+
 * series, hover tooltips, recessive grid, and a "View as table" fallback.
 * Palette (dark, validated against the panel surface): blue, orange, aqua,
 * yellow, magenta.
 */

import { SERIES_COLOURS } from "@/lib/chart-colours";

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: n >= 1000 || n <= -1000 ? 0 : 2 }).format(n);
const short = (n: number) => (Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `£${Math.round(n)}`);

export type Series = { id: string; label: string; colour: string; values: number[] };

export function StackedBars({ categories, series, height = 220, title }: { categories: string[]; series: Series[]; height?: number; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const totals = categories.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const niceMax = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  })();
  const W = 600, H = height, padL = 44, padB = 22, padT = 8;
  const plotH = H - padB - padT;
  const step = (W - padL) / categories.length;
  const barW = Math.min(36, step * 0.6);
  const ticks = [0, 0.5, 1].map((t) => t * niceMax);

  if (table) {
    return (
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-muted"><th className="py-1 pr-3 font-normal">Month</th>{series.map((s) => <th key={s.id} className="py-1 pr-3 text-right font-normal">{s.label}</th>)}<th className="py-1 text-right font-normal">Total</th></tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {categories.map((c, i) => (
                <tr key={c} className="border-t border-line"><td className="py-1 pr-3 font-sans">{c}</td>{series.map((s) => <td key={s.id} className="py-1 pr-3 text-right">{gbp(s.values[i] ?? 0)}</td>)}<td className="py-1 text-right">{gbp(totals[i])}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setTable(false)} className="mt-2 text-xs text-accent">View as chart</button>
      </div>
    );
  }

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.colour }} />{s.label}</li>
          ))}
        </ul>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => {
            const y = padT + plotH - (t / niceMax) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={W} y1={y} y2={y} stroke="rgba(120,220,255,0.10)" strokeWidth="1" />
                <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#8aa4bd">{short(t)}</text>
              </g>
            );
          })}
          {categories.map((c, i) => {
            const x = padL + step * i + (step - barW) / 2;
            let y = padT + plotH;
            const segs = series.map((s) => ({ s, v: Math.max(0, s.values[i] ?? 0) })).filter((g) => g.v > 0);
            return (
              <g key={c}>
                <rect x={padL + step * i} y={padT} width={step} height={plotH + padB} fill={hover === i ? "rgba(120,220,255,0.06)" : "transparent"} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${c}: ${gbp(totals[i])}`} />
                {segs.map((g, k) => {
                  const h = (g.v / niceMax) * plotH;
                  y -= h;
                  const top = k === segs.length - 1;
                  const gap = k > 0 ? 2 : 0;
                  return top ? (
                    <path key={g.s.id} pointerEvents="none" fill={g.s.colour} d={roundedTop(x, y, barW, Math.max(0, h - gap), 4)} />
                  ) : (
                    <rect key={g.s.id} pointerEvents="none" x={x} y={y} width={barW} height={Math.max(0, h - gap)} fill={g.s.colour} />
                  );
                })}
                {(categories.length <= 8 || i % 2 === 0 || i === categories.length - 1) && <text x={padL + step * i + step / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#8aa4bd">{c}</text>}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-line-strong bg-bg-elev p-2.5 text-xs shadow-lg" style={hover < categories.length / 2 ? { left: `${((padL + step * (hover + 1)) / W) * 100}%` } : { right: `${100 - ((padL + step * hover) / W) * 100}%` }}>
            <p className="mb-1 font-medium">{categories[hover]}</p>
            {series.map((s) => (
              <p key={s.id} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-muted"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.colour }} />{s.label}</span><span className="font-mono tabular-nums">{gbp(s.values[hover] ?? 0)}</span></p>
            ))}
            {series.length > 1 && <p className="mt-1 flex justify-between border-t border-line pt-1"><span className="text-muted">Total</span><span className="font-mono tabular-nums">{gbp(totals[hover])}</span></p>}
          </div>
        )}
      </div>
      <button type="button" onClick={() => setTable(true)} className="mt-1 text-xs text-accent">View as table</button>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Horizontal bar list for a single measure (one series → no legend; the title names it). */
export function BarList({ rows, colour = SERIES_COLOURS[0] }: { rows: { label: string; value: number; note?: string }[]; colour?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${gbp(r.value)}`}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{gbp(r.value)}{r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-bg-elev">
            <div className="h-full rounded-full" style={{ width: `${Math.max(1, (Math.max(0, r.value) / max) * 100)}%`, background: colour }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
