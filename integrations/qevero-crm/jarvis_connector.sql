-- ════════════════════════════════════════════════════════════════════════════
-- Jarvis ↔ Qevero CRM connector (READ-ONLY)
--
-- Run this in the CRM's Supabase project (SQL editor), or copy it into the
-- CRM repo as a new migration, e.g.
--   supabase/migrations/20261102090000_jarvis_connector.sql
--
-- It adds ONE function, public.jarvis_crm(token, action, args), which returns
-- read-only JSON for a single organisation. Access requires a secret token
-- whose SHA-256 hash is stored in jarvis.connector (no RLS policies, no grants:
-- unreadable through the API). The function never writes to CRM data.
--
-- After running it, set the token (generate one with `openssl rand -hex 32`):
--   insert into jarvis.connector (org_id, token_hash)
--   values ((select id from public.organisations where name ilike 'Qevero%' limit 1),
--           encode(sha256(convert_to('PASTE-TOKEN-HERE', 'UTF8')), 'hex'))
--   on conflict (id) do update set org_id = excluded.org_id, token_hash = excluded.token_hash, rotated_at = now();
-- Then add the same token to Jarvis's Netlify env as CRM_CONNECTOR_TOKEN.
-- To revoke: delete from jarvis.connector;
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists jarvis;
revoke all on schema jarvis from public, anon, authenticated;

create table if not exists jarvis.connector (
  id smallint primary key default 1 check (id = 1),
  org_id uuid not null references public.organisations (id) on delete cascade,
  token_hash text not null check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
revoke all on jarvis.connector from public, anon, authenticated;

create or replace function public.jarvis_crm(p_token text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit int := least(greatest(coalesce((p_args ->> 'limit')::int, 25), 1), 100);
  v_q text := nullif(trim(coalesce(p_args ->> 'q', '')), '');
  v_id uuid;
  v_result jsonb;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  select c.org_id into v_org
  from jarvis.connector c
  where c.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if v_org is null then
    raise exception 'Invalid connector token' using errcode = '28000';
  end if;

  if p_args ? 'id' and (p_args ->> 'id') ~* '^[0-9a-f-]{36}$' then
    v_id := (p_args ->> 'id')::uuid;
  end if;

  case p_action
  -- ── overview: the numbers Jarvis needs for a briefing ─────────────────────
  when 'overview' then
    select jsonb_build_object(
      'counts', jsonb_build_object(
        'open_leads', (select count(*) from public.lead_overview l where l.org_id = v_org and l.archived_at is null and l.stage_kind = 'open'),
        'tasks_overdue', (select count(*) from public.tasks t where t.org_id = v_org and t.completed_at is null and t.due_at < now()),
        'tasks_due_today', (select count(*) from public.tasks t where t.org_id = v_org and t.completed_at is null and (t.due_at at time zone 'Europe/London')::date = v_today),
        'tenders_new', (select count(*) from public.tender_match_overview m where m.org_id = v_org and m.status = 'new' and m.tender_open),
        'tenders_closing_7d', (select count(*) from public.tender_match_overview m where m.org_id = v_org and m.status in ('new', 'reviewing', 'bidding') and m.tender_open and m.deadline < now() + interval '7 days')
      ),
      'quoted_pipeline', (
        select jsonb_build_object('count', count(*), 'one_off', coalesce(sum(l.value_one_off), 0), 'monthly', coalesce(sum(l.value_monthly), 0), 'first_year', coalesce(sum(l.first_year_value), 0))
        from public.lead_overview l join public.pipeline_stages s on s.id = l.stage_id
        where l.org_id = v_org and l.archived_at is null and l.stage_kind = 'open' and s.counts_as_quoted
      ),
      'by_stage', coalesce((
        select jsonb_agg(x order by x.position) from (
          select s.name as stage, s.kind, s.position, count(l.id) as leads, coalesce(sum(l.first_year_value), 0) as first_year
          from public.pipeline_stages s
          left join public.lead_overview l on l.stage_id = s.id and l.archived_at is null
          where s.org_id = v_org and s.kind = 'open'
          group by s.id, s.name, s.kind, s.position
        ) x
      ), '[]'::jsonb),
      'won_90d', (select jsonb_build_object('count', count(*), 'first_year', coalesce(sum(l.first_year_value), 0)) from public.lead_overview l where l.org_id = v_org and l.won_at > now() - interval '90 days'),
      'lost_90d', (select count(*) from public.lead_overview l where l.org_id = v_org and l.lost_at > now() - interval '90 days'),
      'lead_deadlines_14d', coalesce((
        select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'company', l.company_name, 'deadline', l.deadline, 'label', l.deadline_label, 'stage', l.stage_name) order by l.deadline)
        from public.lead_overview l
        where l.org_id = v_org and l.archived_at is null and l.stage_kind = 'open' and l.deadline between v_today - 7 and v_today + 14
      ), '[]'::jsonb),
      'recent_activity', coalesce((
        select jsonb_agg(x) from (
          select a.occurred_at, a.type, a.subject, c.name as company, a.direction
          from public.activities a left join public.companies c on c.id = a.company_id
          where a.org_id = v_org order by a.occurred_at desc limit 10
        ) x
      ), '[]'::jsonb)
    ) into v_result;

  -- ── leads: filtered list ──────────────────────────────────────────────────
  when 'leads' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select l.id, l.title, l.company_name as company, l.contact_name as contact, l.stage_name as stage, l.stage_kind,
             l.value_one_off, l.value_monthly, l.first_year_value, l.score, l.services, l.source_name as source,
             l.expected_close_date, l.deadline, l.deadline_label, l.next_task_title, l.next_task_due_at, l.updated_at
      from public.lead_overview l
      where l.org_id = v_org and l.archived_at is null
        and (coalesce(p_args ->> 'status', 'open') = 'all' or l.stage_kind::text = coalesce(p_args ->> 'status', 'open'))
        and (p_args ->> 'stage' is null or l.stage_name ilike p_args ->> 'stage')
        and (v_q is null or l.title ilike '%' || v_q || '%' or l.company_name ilike '%' || v_q || '%' or l.contact_name ilike '%' || v_q || '%')
      order by l.score desc nulls last, l.updated_at desc
      limit v_limit
    ) x;

  -- ── lead: one lead with tasks and timeline ───────────────────────────────
  when 'lead' then
    if v_id is null and v_q is not null then
      select l.id into v_id from public.lead_overview l where l.org_id = v_org and l.archived_at is null and (l.title ilike '%' || v_q || '%' or l.company_name ilike '%' || v_q || '%') order by l.updated_at desc limit 1;
    end if;
    select jsonb_build_object(
      'lead', to_jsonb(l) - 'org_id' - 'board_position' - 'created_by',
      'open_tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'due_at', t.due_at, 'notes', left(t.notes, 300)) order by t.due_at nulls last) from public.tasks t where t.lead_id = l.id and t.completed_at is null), '[]'::jsonb),
      'timeline', coalesce((select jsonb_agg(x) from (select a.occurred_at, a.type, a.subject, left(a.body, 400) as body, a.direction from public.activities a where a.lead_id = l.id order by a.occurred_at desc limit 15) x), '[]'::jsonb)
    ) into v_result
    from public.lead_overview l where l.org_id = v_org and l.id = v_id;
    if v_result is null then raise exception 'Lead not found'; end if;

  -- ── tasks: open tasks (overdue first) ────────────────────────────────────
  when 'tasks' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select t.id, t.title, t.due_at, t.due_at < now() as overdue, left(t.notes, 300) as notes, l.title as lead, c.name as company,
             coalesce(p.short_name, p.full_name) as assignee
      from public.tasks t
      left join public.leads l on l.id = t.lead_id
      left join public.companies c on c.id = coalesce(t.company_id, l.company_id)
      left join public.profiles p on p.id = t.assignee_id
      where t.org_id = v_org and t.completed_at is null
        and (t.due_at is null or t.due_at < now() + make_interval(days => least(greatest(coalesce((p_args ->> 'days')::int, 7), 0), 90)))
      order by t.due_at asc nulls last
      limit v_limit
    ) x;

  -- ── tenders: matched public tenders still open ───────────────────────────
  when 'tenders' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select m.title, m.buyer_name, m.value_amount, m.value_currency, m.deadline, m.status, m.search_name, m.search_service, m.notice_url, m.lead_title, left(m.notes, 300) as notes, m.source
      from public.tender_match_overview m
      where m.org_id = v_org and m.tender_open and m.status in ('new', 'reviewing', 'bidding')
        and (p_args ->> 'status' is null or m.status::text = p_args ->> 'status')
      order by m.deadline asc nulls last
      limit v_limit
    ) x;

  -- ── search: companies, contacts and leads ────────────────────────────────
  when 'search' then
    if v_q is null then raise exception 'Search needs q'; end if;
    select jsonb_build_object(
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'website', c.website, 'industry', c.industry)) from (select * from public.companies c where c.org_id = v_org and c.archived_at is null and c.name ilike '%' || v_q || '%' limit 10) c), '[]'::jsonb),
      'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'name', trim(ct.first_name || ' ' || coalesce(ct.last_name, '')), 'email', ct.email, 'phone', ct.phone, 'job_title', ct.job_title, 'company', co.name)) from (select * from public.contacts ct where ct.org_id = v_org and ct.archived_at is null and (ct.first_name || ' ' || coalesce(ct.last_name, '') ilike '%' || v_q || '%' or ct.email ilike '%' || v_q || '%') limit 10) ct left join public.companies co on co.id = ct.company_id), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'company', l.company_name, 'stage', l.stage_name, 'first_year_value', l.first_year_value)) from (select * from public.lead_overview l where l.org_id = v_org and l.archived_at is null and (l.title ilike '%' || v_q || '%' or l.company_name ilike '%' || v_q || '%') limit 10) l), '[]'::jsonb)
    ) into v_result;

  -- ── company: one company with contacts, leads and recent activity ────────
  when 'company' then
    if v_id is null and v_q is not null then
      select c.id into v_id from public.companies c where c.org_id = v_org and c.archived_at is null and c.name ilike '%' || v_q || '%' order by length(c.name) limit 1;
    end if;
    select jsonb_build_object(
      'company', jsonb_build_object('id', c.id, 'name', c.name, 'website', c.website, 'industry', c.industry, 'phone', c.phone, 'address', c.address, 'notes', left(c.notes, 1000), 'tags', c.tags),
      'contacts', coalesce((select jsonb_agg(jsonb_build_object('name', trim(ct.first_name || ' ' || coalesce(ct.last_name, '')), 'email', ct.email, 'phone', ct.phone, 'job_title', ct.job_title, 'decision_maker', ct.is_decision_maker)) from public.contacts ct where ct.company_id = c.id and ct.archived_at is null), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'stage', l.stage_name, 'kind', l.stage_kind, 'first_year_value', l.first_year_value, 'won_at', l.won_at)) from public.lead_overview l where l.company_id = c.id and l.archived_at is null), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(x) from (select a.occurred_at, a.type, a.subject, left(a.body, 300) as body, a.direction from public.activities a where a.company_id = c.id order by a.occurred_at desc limit 15) x), '[]'::jsonb)
    ) into v_result
    from public.companies c where c.org_id = v_org and c.id = v_id;
    if v_result is null then raise exception 'Company not found'; end if;

  -- ── activity: recent timeline across the CRM ─────────────────────────────
  when 'activity' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select a.occurred_at, a.type, a.subject, left(a.body, 300) as body, a.direction, c.name as company, l.title as lead
      from public.activities a
      left join public.companies c on c.id = a.company_id
      left join public.leads l on l.id = a.lead_id
      where a.org_id = v_org and a.occurred_at > now() - make_interval(days => least(greatest(coalesce((p_args ->> 'days')::int, 7), 1), 90))
      order by a.occurred_at desc
      limit v_limit
    ) x;

  else
    raise exception 'Unknown action %', p_action;
  end case;

  return v_result;
end;
$$;

revoke all on function public.jarvis_crm(text, text, jsonb) from public;
grant execute on function public.jarvis_crm(text, text, jsonb) to anon, authenticated;
