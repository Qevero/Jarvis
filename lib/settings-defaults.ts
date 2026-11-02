/** Jarvis preferences (stored in public.settings.prefs). Thresholds drive attention flags and reminders. */
export type Prefs = {
  /** Flag a stream when the last complete month is this % below its trailing 3-month average. */
  streamDropPct: number;
  /** Ignore streams whose trailing average is below this (£), to avoid noise. */
  streamDropMinAverage: number;
  /** Invoices this many days past due are flagged. */
  overdueDays: number;
  /** Client concentration thresholds (% of last 12 months' revenue). */
  concentrationTop1Pct: number;
  concentrationTop3Pct: number;
  /** Only judge concentration once 12-month revenue exceeds this (£). */
  concentrationMinRevenue: number;
  /** A retainer not invoiced by this day of the month is flagged. */
  retainerGraceDay: number;
  /** Draft invoices older than this many days are flagged. */
  staleDraftDays: number;
  /** Proposals sent this many days ago without a decision are flagged. */
  proposalFollowUpDays: number;
  /** Local hour (UK) for the morning briefing push notification. */
  briefingHour: number;
  /** Days before a deadline to remind (push + Microsoft To Do task). */
  reminderLeadDays: number[];
  /** Create Microsoft To Do tasks for upcoming deadlines. */
  deadlineTasks: boolean;
  /** Associated companies (corporation tax limits are divided by 1 + this). */
  associatedCompanies: number;
  /** Default payment terms (days) for new invoices. */
  paymentTermsDays: number;
  /** Default Xero revenue account code for new invoice lines. */
  defaultSalesAccount: string;
  /** Default Xero expense account for purchase orders. */
  defaultPurchaseAccount: string;
  /** Hours between automatic Xero syncs (Starter tier call budget). */
  xeroSyncHours: number;
  /** Max Xero API calls Jarvis will make per day. */
  xeroDailyCallBudget: number;
  /** Personal: home location for weather. */
  homeLocationName: string;
  homeLat: number;
  homeLon: number;
  /** Personal: health goals (0 = not set). */
  calorieTarget: number;
  proteinTarget: number;
  targetWeightKg: number;
  workoutsPerWeek: number;
  /** Days to keep forwarded messages before they're deleted. */
  messageRetentionDays: number;
};

export const DEFAULT_PREFS: Prefs = {
  streamDropPct: 25,
  streamDropMinAverage: 250,
  overdueDays: 7,
  concentrationTop1Pct: 40,
  concentrationTop3Pct: 75,
  concentrationMinRevenue: 2000,
  retainerGraceDay: 7,
  staleDraftDays: 7,
  proposalFollowUpDays: 10,
  briefingHour: 7,
  reminderLeadDays: [30, 7, 1],
  deadlineTasks: true,
  associatedCompanies: 0,
  paymentTermsDays: 14,
  defaultSalesAccount: "200",
  defaultPurchaseAccount: "429",
  xeroSyncHours: 6,
  xeroDailyCallBudget: 900,
  homeLocationName: "Norwich",
  homeLat: 52.6309,
  homeLon: 1.2974,
  calorieTarget: 0,
  proteinTarget: 0,
  targetWeightKg: 0,
  workoutsPerWeek: 0,
  messageRetentionDays: 14,
};

export function mergePrefs(stored: unknown): Prefs {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Prefs>;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const v = s[k];
    if (v === undefined || v === null) continue;
    if (typeof DEFAULT_PREFS[k] === typeof v || (Array.isArray(DEFAULT_PREFS[k]) && Array.isArray(v))) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
