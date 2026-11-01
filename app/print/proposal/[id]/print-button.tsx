"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
      Print / Save as PDF
    </button>
  );
}
