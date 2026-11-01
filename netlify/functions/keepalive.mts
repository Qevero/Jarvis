import type { Config } from "@netlify/functions";

/**
 * Daily ping so the free Supabase project isn't paused for inactivity.
 * Calls a constant-returning SQL function; reads no data.
 */
const keepalive = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("keepalive: Supabase env vars missing");
    return;
  }
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/ping`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}",
  });
  console.log(`keepalive: ${res.status}`);
};

export default keepalive;

export const config: Config = { schedule: "@daily" };
