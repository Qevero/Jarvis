import type { Config } from "@netlify/functions";

/**
 * Hourly: calls Jarvis's /api/cron/tick (Xero sync, morning briefing push,
 * deadline reminders, Supabase keep-alive). Authenticated with CRON_SECRET.
 */
const tick = async () => {
  const site = Netlify.env.get("URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!site || !secret) {
    console.error("cron-tick: URL or CRON_SECRET missing");
    return;
  }
  const res = await fetch(`${site}/api/cron/tick`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  console.log(`cron-tick: ${res.status} ${(await res.text()).slice(0, 500)}`);
};

export default tick;

// Every hour on the hour (UTC). The tick itself decides what to do based on UK local time
// (briefing hour, reminders from 08:00), so BST/GMT changes need no cron edits.
export const config: Config = { schedule: "0 * * * *" };
