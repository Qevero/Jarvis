-- Jarvis · Labs: "Send to Jarvis" captures (share sheet), daily check-ins.

-- Device tokens can also send captures.
alter table public.ingest_tokens drop constraint if exists ingest_tokens_scopes_check;
alter table public.ingest_tokens add constraint ingest_tokens_scopes_check
  check (scopes <@ array['health', 'workouts', 'messages', 'capture']::text[] and cardinality(scopes) > 0);

-- ─── Captures: anything shared to Jarvis from the iPhone share sheet ───────
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('note', 'link', 'whatsapp', 'file')),
  title text,
  url text,
  body_enc text,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists captures_owner_time on public.captures (owner_id, created_at desc);

-- ─── Daily check-in (mood, energy, sleep quality, stress: 1–5) ─────────────
create table if not exists public.checkins (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  sleep smallint check (sleep between 1 and 5),
  stress smallint check (stress between 1 and 5),
  note text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['captures', 'checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Token-gated capture insert (body already encrypted by Jarvis's server).
create or replace function public.jarvis_capture(p_token text, p_kind text, p_title text, p_url text, p_body_enc text, p_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token uuid;
  v_id uuid;
begin
  select t.owner_id, t.id into v_owner, v_token
  from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and t.revoked_at is null and 'capture' = any (t.scopes);
  if v_owner is null then
    raise exception 'Invalid or revoked token for capture' using errcode = '28000';
  end if;
  insert into public.captures (owner_id, kind, title, url, body_enc, meta)
  values (v_owner, p_kind, left(p_title, 300), left(p_url, 2000), p_body_enc, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  update public.ingest_tokens set last_used_at = now() where id = v_token;
  return v_id;
end;
$$;
revoke all on function public.jarvis_capture(text, text, text, text, text, jsonb) from public;
grant execute on function public.jarvis_capture(text, text, text, text, text, jsonb) to anon, authenticated;
