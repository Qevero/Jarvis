import type { Config } from "@netlify/functions";

/**
 * Hourly: calls Jarvis's /api/cron/tick (Xero sync, morning briefing push,
 * deadline reminders, Supabase keep-alive). Authenticated with CRON_SECRET.
 */
const tick = async () => {
  const site = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!site || !secret) {
    console.error("cron-tick: URL or CRON_SECRET missing");
    return;
  }
  const res = await fetch(`${site}/api/cron/tick`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  console.log(`cron-tick: ${res.status} ${(await res.text()).slice(0, 500)}`);
};

export default tick;

export const config: Config = { schedule: "@hourly" };
