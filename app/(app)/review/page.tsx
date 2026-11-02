import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatUkDate } from "@/lib/dates";
import { gatherWeeklyReview } from "@/lib/services/labs";
import { ActionForm } from "@/components/forms";
import { PageHeader, Panel, SectionTitle } from "@/components/ui";
import { SpeakButton } from "@/components/voice";
import { saveReviewToJournalAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const ctx = await dashboardCtx("/review");
  const r = await gatherWeeklyReview(ctx);

  return (
    <div className="space-y-6 fade-in">
      <PageHeader label="Weekly review · Labs" title={`Your week, ${formatUkDate(r.input.weekStart)} – ${formatUkDate(r.input.weekEnd)}`} sub="Business and life together. You'll get a notification every Sunday at 18:00.">
        <SpeakButton text={r.spoken} label="Listen" />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Wins">
          {r.wins.length ? <ul className="space-y-2 text-sm">{r.wins.map((w) => <li key={w} className="flex gap-2"><span className="text-ok">✓</span>{w}</li>)}</ul> : <p className="text-sm text-muted">Nothing stood out — that&apos;s fine.</p>}
        </Panel>
        <Panel title="Keep an eye on">
          {r.watch.length ? <ul className="space-y-2 text-sm">{r.watch.map((w) => <li key={w} className="flex gap-2"><span className="text-warn">!</span>{w}</li>)}</ul> : <p className="text-sm text-muted">Nothing to flag.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {r.sections.map((s) => (
          <Panel key={s.id} title={s.title}>
            <ul className="space-y-1.5 text-sm">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Panel>
        ))}
      </div>

      <section>
        <SectionTitle>Reflect</SectionTitle>
        <Panel>
          <ActionForm action={saveReviewToJournalAction} submit="Save to journal">
            <div className="space-y-4">
              {r.prompts.map((p, i) => (
                <label key={p} className="block">
                  <span className="text-sm font-medium">{p}</span>
                  <textarea name={`r${i + 1}`} rows={2} className="input mt-1.5" />
                </label>
              ))}
            </div>
          </ActionForm>
        </Panel>
      </section>
    </div>
  );
}
