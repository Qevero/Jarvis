// Runs the real Jarvis migrations in PGlite (Postgres in WebAssembly) with
// small stand-ins for Supabase's auth and storage schemas, so triggers,
// functions and Row Level Security are tested for real.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

export async function database() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    alter default privileges in schema public grant all on tables to authenticated, anon;
    alter default privileges in schema public grant all on functions to authenticated, anon;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(readFileSync(MIGRATIONS + file, "utf8"));

  async function addUser(id: string, email: string) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  }

  /** Run SQL as a signed-in user (role authenticated, auth.uid() = userId). */
  async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []) {
    await db.exec(`set role ${userId ? "authenticated" : "anon"}; select set_config('request.jwt.sub', '${userId ?? ""}', false);`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("reset role; select set_config('request.jwt.sub', '', false);");
    }
  }

  return { db, addUser, as };
}
