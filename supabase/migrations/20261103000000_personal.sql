-- Jarvis · Personal side: health (MyFitnessPal / Apple Health), training (Hevy),
-- missed messages (iMessage / SMS / WhatsApp via your own devices), and
-- device ingest tokens. All owner-scoped with Row Level Security.

-- New integration and memory kinds
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check check (provider in ('xero', 'microsoft', 'hevy'));
alter table public.knowledge_items drop constraint if exists knowledge_items_kind_check;
alter table public.knowledge_items add constraint knowledge_items_kind_check
  check (kind in ('fact', 'preference', 'decision', 'person', 'client', 'process', 'idea', 'goal', 'lesson', 'health', 'personal'));

-- ─── Device ingest tokens (iPhone Shortcuts, Mac bridge) ────────────────────
-- Only a SHA-256 hash is stored; the token is shown once when created.
create table if not exists public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  token_hash text not null unique check (length(token_hash) = 64),
  scopes text[] not null check (scopes <@ array['health', 'workouts', 'messages']::text[] and cardinality(scopes) > 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- ─── Health: one row per day (merged from Apple Health / manual) ───────────
create table if not exists public.health_daily (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  energy_kcal numeric(8, 1),
  protein_g numeric(7, 1),
  carbs_g numeric(7, 1),
  fat_g numeric(7, 1),
  fibre_g numeric(7, 1),
  water_ml numeric(8, 1),
  weight_kg numeric(6, 2),
  body_fat_pct numeric(5, 2),
  steps integer,
  active_kcal numeric(8, 1),
  exercise_min numeric(6, 1),
  resting_hr numeric(5, 1),
  sleep_hours numeric(4, 2),
  source text not null default 'apple_health',
  updated_at timestamptz not null default now(),
  primary key (owner_id, day)
);

-- ─── Workouts (Hevy API, Apple Health, manual) ─────────────────────────────
create table if not exists public.workouts (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('hevy', 'apple_health', 'manual')),
  workout_id text not null,
  title text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_min numeric(6, 1),
  volume_kg numeric(10, 1),
  set_count integer,
  active_kcal numeric(8, 1),
  exercises jsonb not null default '[]'::jsonb,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, source, workout_id)
);
create index if not exists workouts_owner_time on public.workouts (owner_id, started_at desc);

-- ─── Missed messages (bodies encrypted by the app; auto-purged) ────────────
create table if not exists public.messages_inbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null check (source in ('imessage', 'sms', 'whatsapp', 'other')),
  external_id text not null,
  chat_name text,
  sender text,
  is_group boolean not null default false,
  sent_at timestamptz not null,
  body_enc text not null,
  seen_at timestamptz,
  received_at timestamptz not null default now(),
  unique (owner_id, source, external_id)
);
create index if not exists messages_owner_time on public.messages_inbox (owner_id, sent_at desc);

-- ─── Row Level Security ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ingest_tokens', 'health_daily', 'workouts', 'messages_inbox'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ─── Device ingest (token-gated; callable with the publishable key) ────────
-- p_kind: 'health' (rows: day + metrics), 'workouts', 'messages' (bodies
-- already encrypted by Jarvis's server). Validates the token's scope, upserts
-- for that token's owner only, and purges messages past the retention window.
create or replace function public.jarvis_ingest(p_token text, p_kind text, p_rows jsonb, p_retention_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_token uuid;
  v_count integer := 0;
  r jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be an array of at most 500 items';
  end if;

  select t.owner_id, t.id into v_owner, v_token
  from public.ingest_tokens t
  where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and t.revoked_at is null
    and (case when p_kind = 'messages_read' then 'messages' else p_kind end) = any (t.scopes);
  if v_owner is null then
    raise exception 'Invalid or revoked token for %', p_kind using errcode = '28000';
  end if;

  if p_kind = 'health' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.health_daily as h (owner_id, day, energy_kcal, protein_g, carbs_g, fat_g, fibre_g, water_ml, weight_kg, body_fat_pct, steps, active_kcal, exercise_min, resting_hr, sleep_hours, source, updated_at)
      values (v_owner, (r ->> 'day')::date, (r ->> 'energy_kcal')::numeric, (r ->> 'protein_g')::numeric, (r ->> 'carbs_g')::numeric, (r ->> 'fat_g')::numeric,
              (r ->> 'fibre_g')::numeric, (r ->> 'water_ml')::numeric, (r ->> 'weight_kg')::numeric, (r ->> 'body_fat_pct')::numeric, (r ->> 'steps')::integer,
              (r ->> 'active_kcal')::numeric, (r ->> 'exercise_min')::numeric, (r ->> 'resting_hr')::numeric, (r ->> 'sleep_hours')::numeric,
              coalesce(r ->> 'source', 'apple_health'), now())
      on conflict (owner_id, day) do update set
        energy_kcal = coalesce(excluded.energy_kcal, h.energy_kcal),
        protein_g = coalesce(excluded.protein_g, h.protein_g),
        carbs_g = coalesce(excluded.carbs_g, h.carbs_g),
        fat_g = coalesce(excluded.fat_g, h.fat_g),
        fibre_g = coalesce(excluded.fibre_g, h.fibre_g),
        water_ml = coalesce(excluded.water_ml, h.water_ml),
        weight_kg = coalesce(excluded.weight_kg, h.weight_kg),
        body_fat_pct = coalesce(excluded.body_fat_pct, h.body_fat_pct),
        steps = coalesce(excluded.steps, h.steps),
        active_kcal = coalesce(excluded.active_kcal, h.active_kcal),
        exercise_min = coalesce(excluded.exercise_min, h.exercise_min),
        resting_hr = coalesce(excluded.resting_hr, h.resting_hr),
        sleep_hours = coalesce(excluded.sleep_hours, h.sleep_hours),
        updated_at = now();
      v_count := v_count + 1;
    end loop;

  elsif p_kind = 'workouts' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.workouts (owner_id, source, workout_id, title, started_at, ended_at, duration_min, volume_kg, set_count, active_kcal, exercises, notes, updated_at)
      values (v_owner, coalesce(r ->> 'source', 'apple_health'), r ->> 'workout_id', r ->> 'title', (r ->> 'started_at')::timestamptz, (r ->> 'ended_at')::timestamptz,
              (r ->> 'duration_min')::numeric, (r ->> 'volume_kg')::numeric, (r ->> 'set_count')::integer, (r ->> 'active_kcal')::numeric,
              coalesce(r -> 'exercises', '[]'::jsonb), r ->> 'notes', now())
      on conflict (owner_id, source, workout_id) do update set
        title = excluded.title, started_at = excluded.started_at, ended_at = excluded.ended_at, duration_min = excluded.duration_min,
        volume_kg = excluded.volume_kg, set_count = excluded.set_count, active_kcal = excluded.active_kcal, exercises = excluded.exercises,
        notes = excluded.notes, updated_at = now();
      v_count := v_count + 1;
    end loop;

  elsif p_kind = 'messages' then
    for r in select * from jsonb_array_elements(p_rows) loop
      insert into public.messages_inbox (owner_id, source, external_id, chat_name, sender, is_group, sent_at, body_enc)
      values (v_owner, r ->> 'source', r ->> 'external_id', left(r ->> 'chat_name', 200), left(r ->> 'sender', 200), coalesce((r ->> 'is_group')::boolean, false),
              (r ->> 'sent_at')::timestamptz, r ->> 'body_enc')
      on conflict (owner_id, source, external_id) do nothing;
      if found then v_count := v_count + 1; end if;
    end loop;
    delete from public.messages_inbox m
    where m.owner_id = v_owner and m.sent_at < now() - make_interval(days => least(greatest(coalesce(p_retention_days, 14), 1), 90));

  elsif p_kind = 'messages_read' then
    -- The device reports messages it has seen were read on the phone/Mac.
    update public.messages_inbox m set seen_at = now()
    from jsonb_array_elements(p_rows) x
    where m.owner_id = v_owner and m.seen_at is null and m.source = x ->> 'source' and m.external_id = x ->> 'external_id';
    get diagnostics v_count = row_count;

  else
    raise exception 'Unknown kind %', p_kind;
  end if;

  update public.ingest_tokens set last_used_at = now() where id = v_token;
  return jsonb_build_object('kind', p_kind, 'accepted', v_count);
end;
$$;

revoke all on function public.jarvis_ingest(text, text, jsonb, integer) from public;
grant execute on function public.jarvis_ingest(text, text, jsonb, integer) to anon, authenticated;
