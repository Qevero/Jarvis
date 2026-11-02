"use client";
import { useActionState, useState } from "react";
import { saveCheckinAction } from "@/app/(app)/actions";
import type { ActionState } from "@/components/forms";

const SCALES = [
  { key: "mood", label: "Mood", faces: ["😞", "🙁", "😐", "🙂", "😄"] },
  { key: "energy", label: "Energy", faces: ["🪫", "😴", "😐", "⚡", "🚀"] },
  { key: "sleep", label: "Sleep", faces: ["😵", "🥱", "😐", "😌", "🛌"] },
  { key: "stress", label: "Stress", faces: ["🧘", "🙂", "😐", "😬", "🤯"] },
] as const;

type Values = Partial<Record<(typeof SCALES)[number]["key"], number>>;

/** Daily check-in: four 1–5 scales, one tap each, plus an optional note. */
export function CheckinCard({ initial, compact = false }: { initial?: Values & { note?: string | null }; compact?: boolean }) {
  const [vals, setVals] = useState<Values>(initial ?? {});
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCheckinAction, null);
  return (
    <form action={action} className="space-y-3">
      {SCALES.map((s) => (
        <fieldset key={s.key} className="flex items-center gap-3">
          <legend className="sr-only">{s.label}</legend>
          <span className="w-16 shrink-0 text-sm text-muted">{s.label}</span>
          <input type="hidden" name={s.key} value={vals[s.key] ?? ""} />
          <div className="grid flex-1 grid-cols-5 gap-1.5">
            {s.faces.map((f, i) => {
              const v = i + 1;
              const on = vals[s.key] === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-label={`${s.label} ${v} of 5`}
                  aria-pressed={on}
                  onClick={() => setVals((x) => ({ ...x, [s.key]: on ? undefined : v }))}
                  className={`flex h-11 items-center justify-center rounded-xl border text-lg transition ${on ? "border-accent bg-accent/15 scale-[1.03]" : "border-line bg-white/[0.02] opacity-70 hover:opacity-100"}`}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {!compact && <input name="note" defaultValue={initial?.note ?? ""} placeholder="Anything on your mind? (optional)" className="input" />}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={pending || !Object.values(vals).some(Boolean)}>{pending ? "Saving…" : initial && Object.keys(initial).length ? "Update check-in" : "Check in"}</button>
        {state && <span className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
