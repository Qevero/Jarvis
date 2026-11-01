import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the Qevero CRM's real migrations plus Jarvis's read-only connector in
 * PGlite. Needs the CRM repo cloned at ./qevero-crm (skipped otherwise).
 */
const CRM = fileURLToPath(new URL("../../qevero-crm/supabase/migrations/", import.meta.url));
const CONNECTOR = fileURLToPath(new URL("../../integrations/qevero-crm/jarvis_connector.sql", import.meta.url));
const available = existsSync(CRM);

const MIGRATIONS = [
  "20261008000000_init.sql",
  "20261009120000_dashboard.sql",
  "20261010090000_tenders.sql",
  "20261011090000_tenders_keep_newest.sql",
  "20261012090000_tender_screens.sql",
  "20261013090000_tender_relevance.sql",
  "20261014090000_contracts_finder.sql",
  "20261015090000_outlook.sql",
  "20261016090000_outlook_screens.sql",
  "20261024090000_board_visibility.sql",
  "20261025090000_team.sql",
  "20261025090100_quoted_pipeline.sql",
];

const TOKEN = "a".repeat(64);
const USER = "11111111-1111-1111-1111-111111111111";
let db: PGlite;
let org: string;

describe.skipIf(!available)("Qevero CRM connector", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      grant usage on schema public to authenticated, anon;
      alter default privileges in schema public grant all on tables to authenticated;
    `);
    for (const f of MIGRATIONS) await db.exec(readFileSync(CRM + f, "utf8").replace(/create extension[^;]*;/g, ""));
    await db.exec(readFileSync(CONNECTOR, "utf8"));

    await db.query("insert into auth.users (id, email) values ($1, 'jasper@qevero.com')", [USER]);
    await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${USER}', false);`);
    org = (await db.query<{ id: string }>("select public.create_organisation('Qevero') as id")).rows[0].id;
    const stage = (await db.query<{ id: string }>("select id from public.pipeline_stages where org_id = $1 and counts_as_quoted order by position limit 1", [org])).rows[0].id;
    const company = (await db.query<{ id: string }>("insert into public.companies (org_id, name) values ($1, 'World of Beds') returning id", [org])).rows[0].id;
    const lead = (await db.query<{ id: string }>("insert into public.leads (org_id, title, company_id, stage_id, value_one_off, value_monthly) values ($1, 'Website rebuild', $2, $3, 4500, 750) returning id", [org, company, stage])).rows[0].id;
    await db.query("insert into public.tasks (org_id, title, lead_id, due_at) values ($1, 'Chase proposal', $2, now() - interval '1 day')", [org, lead]);
    await db.exec("reset role; select set_config('request.jwt.sub', '', false);");
    await db.query("insert into jarvis.connector (org_id, token_hash) values ($1, encode(sha256(convert_to($2, 'UTF8')), 'hex'))", [org, TOKEN]);
  }, 120_000);

  const call = async (action: string, args: Record<string, unknown> = {}, token = TOKEN) => {
    await db.exec("set role anon;");
    try {
      return (await db.query<{ r: Record<string, unknown> }>("select public.jarvis_crm($1, $2, $3) as r", [token, action, JSON.stringify(args)])).rows[0].r;
    } finally {
      await db.exec("reset role;");
    }
  };

  it("rejects a wrong token and hides the token table from API roles", async () => {
    await expect(call("overview", {}, "b".repeat(64))).rejects.toThrow(/Invalid connector token/);
    await db.exec("set role anon;");
    await expect(db.query("select * from jarvis.connector")).rejects.toThrow();
    await db.exec("reset role;");
  });

  it("returns an overview with the quoted pipeline and overdue tasks", async () => {
    const o = await call("overview");
    expect((o.counts as Record<string, number>).tasks_overdue).toBe(1);
    expect(o.quoted_pipeline).toMatchObject({ count: 1, one_off: 4500, monthly: 750, first_year: 13500 });
  });

  it("lists leads, finds a lead by name with tasks, searches and lists tasks", async () => {
    const leads = (await call("leads")) as unknown as { title: string; company: string }[];
    expect(leads[0]).toMatchObject({ title: "Website rebuild", company: "World of Beds" });
    const lead = await call("lead", { q: "World of Beds" });
    expect((lead.open_tasks as { title: string }[])[0].title).toBe("Chase proposal");
    const s = await call("search", { q: "beds" });
    expect((s.companies as unknown[]).length).toBe(1);
    const tasks = (await call("tasks")) as unknown as { overdue: boolean; company: string }[];
    expect(tasks[0]).toMatchObject({ overdue: true, company: "World of Beds" });
    const company = await call("company", { q: "World" });
    expect((company.leads as unknown[]).length).toBe(1);
    expect(await call("tenders")).toEqual([]);
  });

  it("rejects unknown actions", async () => {
    await expect(call("delete_everything")).rejects.toThrow(/Unknown action/);
  });
});
