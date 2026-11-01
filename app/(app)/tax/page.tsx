import { dashboardCtx } from "@/lib/dashboard-ctx";
import { formatGbpFromPence, formatUkDate } from "@/lib/dates";
import { companiesHouseProfile } from "@/lib/companies-house";
import { env } from "@/lib/env";
import { vaultValues } from "@/lib/ctx";
import { RULES, type RuleId } from "@/lib/tax/rules";
import { TAX_DISCLAIMER } from "@/lib/tax/ct";
import { corporationTaxEstimate, taxSetAside, upcomingDeadlines, vatReport, verifications } from "@/lib/services/tax";
import { ActionForm, InlineAction } from "@/components/forms";
import { Empty, PageHeader, Panel, Stat, UnverifiedBadge } from "@/components/ui";
import { deadlineDoneAction, verifyRuleAction } from "../actions";

export const dynamic = "force-dynamic";

const gbp = (n: number) => formatGbpFromPence(Math.round(n * 100));
async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export default async function TaxPage() {
  const ctx = await dashboardCtx("/tax");
  const [deadlines, vat, setAside, ct, ver, vault] = await Promise.all([upcomingDeadlines(ctx, { days: 730, includeDone: true, fromDaysAgo: 90 }), safe(() => vatReport(ctx, "current")), safe(() => taxSetAside(ctx)), safe(() => corporationTaxEstimate(ctx)), verifications(ctx), vaultValues(ctx)]);
  const ch = env.companiesHouseKey() && vault.company_number ? await safe(() => companiesHouseProfile(vault.company_number)) : null;
  const upcoming = deadlines.filter((d) => !d.done);
  const done = deadlines.filter((d) => d.done).slice(-10);

  return (
    <div className="space-y-5">
      <PageHeader label="Compliance" title="Tax & deadlines" sub="Jarvis tracks and prepares. It never submits anything to HMRC or Companies House — VAT returns go through Xero after your accountant's review." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Set aside for tax" value={setAside ? gbp(setAside.total) : "—"} sub="VAT owed + CT accrued (estimate)" tone={setAside && setAside.total > 0 ? "warn" : undefined} />
        <Stat label="VAT this quarter" value={vat ? gbp(vat.position.box5NetVat) : "—"} sub={vat ? `${formatUkDate(vat.period.start)}–${formatUkDate(vat.period.end)} · due ${formatUkDate(vat.dueDate)}` : "Needs Xero data"} />
        <Stat label="CT to date" value={ct ? gbp(ct.toDate.tax) : "—"} sub={ct ? `Projected ${gbp(ct.projectedFullPeriod.tax)} for the period` : "Needs Xero data"} />
        <Stat label="Next deadline" value={upcoming[0] ? `${upcoming[0].daysAway}d` : "—"} sub={upcoming[0]?.title} tone={upcoming[0]?.overdue ? "danger" : upcoming[0] && upcoming[0].daysAway <= 14 ? "warn" : undefined} />
      </div>

      <Panel title="Deadlines">
        {upcoming.length === 0 ? <Empty>No upcoming deadlines.</Empty> : (
          <ul className="divide-y divide-line">
            {upcoming.slice(0, 30).map((d) => (
              <li key={d.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{d.title}{d.personal && <span className="badge ml-2">Personal</span>}</p>
                  <p className={`text-xs ${d.overdue ? "text-danger" : d.daysAway <= 14 ? "text-warn" : "text-muted"}`}>
                    Due {formatUkDate(d.due)} · {d.overdue ? `${-d.daysAway} days overdue` : `in ${d.daysAway} days`} · {d.authority}
                  </p>
                  {d.note && <p className="text-xs text-muted">{d.note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <UnverifiedBadge verified={d.verified} />
                  <InlineAction action={deadlineDoneAction} fields={{ key: d.key }} label="Mark done" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">Recently done ({done.length})</summary>
            <ul className="mt-2 space-y-1">{done.map((d) => <li key={d.key} className="flex items-center justify-between gap-2 text-muted"><span>✓ {d.title}</span><InlineAction action={deadlineDoneAction} fields={{ key: d.key, undo: "1" }} label="Reopen" /></li>)}</ul>
          </details>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={vat ? `VAT position · ${formatUkDate(vat.period.start)} – ${formatUkDate(vat.period.end)}` : "VAT position"}>
          {!vat ? <Empty>Connect Xero and add the VAT registration date and quarter months to the vault.</Empty> : (
            <>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted">Box 1 · VAT on sales</dt><dd className="text-right font-mono tabular-nums">{gbp(vat.position.box1OutputVat)}</dd>
                <dt className="text-muted">Box 4 · VAT reclaimed</dt><dd className="text-right font-mono tabular-nums">{gbp(vat.position.box4InputVat)}</dd>
                <dt className="font-medium">Box 5 · Net VAT {vat.position.box5NetVat < 0 ? "(refund)" : "due"}</dt><dd className="text-right font-mono font-semibold tabular-nums">{gbp(vat.position.box5NetVat)}</dd>
                <dt className="text-muted">Box 6 · Sales ex VAT</dt><dd className="text-right font-mono tabular-nums">{gbp(vat.position.box6NetSales)}</dd>
                <dt className="text-muted">Box 7 · Purchases ex VAT</dt><dd className="text-right font-mono tabular-nums">{gbp(vat.position.box7NetPurchases)}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted">{vat.note}{vat.position.draftsExcluded ? ` ${vat.position.draftsExcluded} draft(s) excluded.` : ""}</p>
              <h3 className="hud-label mt-4 mb-2">Readiness issues ({vat.issues.length})</h3>
              {vat.issues.length === 0 ? <p className="text-sm text-ok">✓ Nothing to fix.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {vat.issues.slice(0, 15).map((i, k) => <li key={k} className="py-1.5"><span className={i.severity === "high" ? "text-danger" : i.severity === "medium" ? "text-warn" : "text-muted"}>●</span> {i.reference}: <span className="text-muted">{i.detail}</span></li>)}
                </ul>
              )}
            </>
          )}
        </Panel>
        <Panel title="Corporation tax estimate">
          {!ct ? <Empty>Needs Xero data.</Empty> : (
            <>
              <p className="mb-2 text-sm text-muted">Accounting period {formatUkDate(ct.accountingPeriod.start)} – {formatUkDate(ct.accountingPeriod.end)}</p>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted">Profit to date</dt><dd className="text-right font-mono tabular-nums">{gbp(ct.profitToDate)}</dd>
                <dt className="text-muted">CT on profit to date</dt><dd className="text-right font-mono tabular-nums">{gbp(ct.toDate.tax)}</dd>
                <dt className="text-muted">Projected full-period profit</dt><dd className="text-right font-mono tabular-nums">{gbp(ct.projectedFullPeriod.profit)}</dd>
                <dt className="font-medium">Projected CT</dt><dd className="text-right font-mono font-semibold tabular-nums">{gbp(ct.projectedFullPeriod.tax)} ({ct.projectedFullPeriod.effectiveRatePct}%)</dd>
              </dl>
              <p className="mt-2 text-xs text-muted">Profit from {ct.profitSource === "xero_report" ? "Xero's P&L report" : "Jarvis's copy of Xero"}. {TAX_DISCLAIMER}</p>
            </>
          )}
        </Panel>
      </div>

      {ch && (
        <Panel title="Companies House cross-check">
          <dl className="grid gap-y-1.5 text-sm sm:grid-cols-2">
            <dt className="text-muted">Status</dt><dd>{ch.status}</dd>
            <dt className="text-muted">Next accounts due (official)</dt><dd>{formatUkDate(ch.accounts.nextDue)}{ch.accounts.nextMadeUpTo ? ` (made up to ${formatUkDate(ch.accounts.nextMadeUpTo)})` : ""}</dd>
            <dt className="text-muted">Next confirmation statement due</dt><dd>{formatUkDate(ch.confirmationStatement.nextDue)}</dd>
            <dt className="text-muted">Jarvis&apos;s dates</dt><dd>Accounts {formatUkDate(deadlines.find((d) => d.ruleId === "accounts")?.due)} · CS {formatUkDate(deadlines.find((d) => d.ruleId === "confirmation_statement")?.due)}</dd>
          </dl>
        </Panel>
      )}

      <Panel title="Rules & verification">
        <p className="mb-3 text-sm text-muted">Deadline rules are configuration, not advice. Confirm each with your accountant, then record it here to remove the “unverified” badge.</p>
        <ul className="divide-y divide-line">
          {(Object.keys(RULES) as RuleId[]).filter((r) => r !== "renewal").map((r) => {
            const v = ver.get(r);
            return (
              <li key={r} className="grid gap-2 py-3 lg:grid-cols-[1fr_22rem]">
                <div>
                  <p className="text-sm font-medium">{RULES[r].label} <UnverifiedBadge verified={Boolean(v)} /></p>
                  <p className="text-xs text-muted">{RULES[r].summary}</p>
                  {v && <p className="text-xs text-ok">Confirmed by {String(v.verified_by)} on {formatUkDate(String(v.verified_at))}</p>}
                </div>
                <ActionForm action={verifyRuleAction} submit={v ? "Mark unverified" : "Mark verified"}>
                  <input type="hidden" name="rule_id" value={r} />
                  {v ? <input type="hidden" name="revoke" value="1" /> : <input name="verified_by" placeholder="Confirmed by (accountant)" className="input min-h-10" />}
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
