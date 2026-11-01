"use client";
import { useState } from "react";

export function SectionsEditor({ initial }: { initial: { heading: string; body: string }[] }) {
  const [sections, setSections] = useState(initial.length ? initial : [{ heading: "", body: "" }]);
  const move = (i: number, d: number) => setSections((s) => {
    const n = [...s];
    const j = i + d;
    if (j < 0 || j >= n.length) return s;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <input name="section_heading" value={s.heading} onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, heading: e.target.value } : y)))} placeholder="Heading" className="input mb-2" />
          <textarea name="section_body" value={s.body} onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, body: e.target.value } : y)))} rows={5} placeholder="Body (use - for bullet points)" className="input" />
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" onClick={() => move(i, -1)} className="text-muted hover:text-fg">↑ Up</button>
            <button type="button" onClick={() => move(i, 1)} className="text-muted hover:text-fg">↓ Down</button>
            <button type="button" onClick={() => setSections((x) => x.filter((_, k) => k !== i))} className="ml-auto text-muted hover:text-danger">Remove</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setSections((x) => [...x, { heading: "", body: "" }])} className="btn btn-ghost btn-sm">+ Add section</button>
    </div>
  );
}
