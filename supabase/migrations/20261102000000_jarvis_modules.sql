-- Jarvis · Modules: journal, memory (knowledge + Claude chat history), clients,
-- Xero mirror, revenue mapping, proposals, tax tracker, integrations, push,
-- settings. Every table is owner-scoped with Row Level Security.

-- ─── Helpers ────────────────────────────────────────────────────────────────
create or replace function public.jarvis_tsv(variadic parts text[]) returns tsvector
language sql immutable set search_path = '' as $$
  select to_tsvector('english'::regconfig, coalesce(array_to_string(parts, ' '), ''))
$$;

-- ─── Settings (one row per owner) ───────────────────────────────────────────
create table if not exists public.settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─── Thought journal ────────────────────────────────────────────────────────
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null default ((now() at time zone 'Europe/London')::date),
  title text not null check (length(title) between 1 and 300),
  raw_notes text,
  summary text,
  themes text[] not null default '{}',
  decisions text[] not null default '{}',
  ideas text[] not null default '{}',
  action_items jsonb not null default '[]'::jsonb,
  linked_clients text[] not null default '{}',
  source text not null default 'claude' check (source in ('claude', 'dashboard', 'voice', 'import')),
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journal_owner_date on public.journal_entries (owner_id, entry_date desc);
create index if not exists journal_search on public.journal_entries using gin (search);
create index if not exists journal_themes on public.journal_entries using gin (themes);

create or replace function public.journal_search_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search := public.jarvis_tsv(new.title, new.summary, new.raw_notes,
    array_to_string(new.themes, ' '), array_to_string(new.decisions, ' '),
    array_to_string(new.ideas, ' '), array_to_string(new.linked_clients, ' '), new.action_items::text);
  return new;
end;
$$;
drop trigger if exists journal_search_trg on public.journal_entries;
create trigger journal_search_trg before insert or update on public.journal_entries
  for each row execute function public.journal_search_update();

-- ─── Memory: knowledge items ────────────────────────────────────────────────
create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'fact' check (kind in ('fact', 'preference', 'decision', 'person', 'client', 'process', 'idea', 'goal', 'lesson')),
  title text not null check (length(title) between 1 and 300),
  content text not null default '',
  tags text[] not null default '{}',
  importance smallint not null default 3 check (importance between 1 and 5),
  pinned boolean not null default false,
  source text not null default 'claude_chat' check (source in ('claude_chat', 'dashboard', 'chat_import', 'journal')),
  source_ref text,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_owner on public.knowledge_items (owner_id, updated_at desc);
create index if not exists knowledge_search on public.knowledge_items using gin (search);

create or replace function public.knowledge_search_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search := public.jarvis_tsv(new.title, new.content, array_to_string(new.tags, ' '), new.kind);
  return new;
end;
$$;
drop trigger if exists knowledge_search_trg on public.knowledge_items;
create trigger knowledge_search_trg before insert or update on public.knowledge_items
  for each row execute function public.knowledge_search_update();

-- ─── Memory: imported Claude conversations ──────────────────────────────────
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  external_id text not null,
  title text,
  started_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  digest text,
  digested_at timestamptz,
  imported_at timestamptz not null default now(),
  unique (owner_id, external_id)
);
create index if not exists chat_conv_owner on public.chat_conversations (owner_id, last_message_at desc nulls last);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  external_id text not null,
  position integer not null,
  sender text not null check (sender in ('human', 'assistant')),
  sent_at timestamptz,
  body text not null,
  search tsvector generated always as (to_tsvector('english'::regconfig, body)) stored,
  unique (owner_id, external_id)
);
create index if not exists chat_msg_conv on public.chat_messages (conversation_id, position);
create index if not exists chat_msg_search on public.chat_messages using gin (search);

-- ─── Clients (links Xero contacts, the CRM and retainers) ───────────────────
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  xero_contact_id text,
  crm_company_id text,
  email text,
  status text not null default 'active' check (status in ('active', 'prospect', 'past')),
  primary_stream text,
  retainer_monthly_pence integer check (retainer_monthly_pence is null or retainer_monthly_pence >= 0),
  retainer_invoice_day smallint check (retainer_invoice_day between 1 and 28),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, xero_contact_id)
);

-- ─── Revenue stream mapping ─────────────────────────────────────────────────
create table if not exists public.stream_account_map (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_code text not null,
  stream text not null,
  primary key (owner_id, account_code)
);
create table if not exists public.stream_line_overrides (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  line_key text not null,
  stream text not null,
  primary key (owner_id, line_key)
);

-- ─── Integrations (tokens encrypted by the app, AES-256-GCM) ────────────────
create table if not exists public.integration_connections (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('xero', 'microsoft')),
  status text not null default 'active' check (status in ('active', 'needs_reconnect', 'disconnected')),
  account_label text,
  tenant_id text,
  tenant_name text,
  scopes text,
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);

-- ─── Xero mirror ────────────────────────────────────────────────────────────
create table if not exists public.xero_contacts (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id text not null,
  name text not null,
  email text,
  is_customer boolean not null default false,
  is_supplier boolean not null default false,
  status text,
  updated_utc timestamptz,
  primary key (owner_id, contact_id)
);

-- Invoices, bills and credit notes (type ACCREC, ACCPAY, ACCRECCREDIT, ACCPAYCREDIT)
create table if not exists public.xero_invoices (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invoice_id text not null,
  type text not null check (type in ('ACCREC', 'ACCPAY', 'ACCRECCREDIT', 'ACCPAYCREDIT')),
  number text,
  reference text,
  contact_id text,
  contact_name text,
  status text not null,
  date date,
  due_date date,
  fully_paid_on date,
  currency_code text not null default 'GBP',
  currency_rate numeric(18, 8) not null default 1,
  line_amount_types text,
  sub_total numeric(14, 2) not null default 0,
  total_tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_due numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  has_attachments boolean not null default false,
  repeating_invoice_id text,
  sent_to_contact boolean,
  updated_utc timestamptz,
  primary key (owner_id, invoice_id)
);
create index if not exists xero_invoices_date on public.xero_invoices (owner_id, type, date);

create table if not exists public.xero_invoice_lines (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invoice_id text not null,
  line_item_id text not null,
  position integer not null default 0,
  description text,
  quantity numeric(14, 4),
  unit_amount numeric(14, 4),
  account_code text,
  tax_type text,
  tax_amount numeric(14, 2) not null default 0,
  line_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  tracking jsonb not null default '[]'::jsonb,
  stream_option text,
  primary key (owner_id, invoice_id, line_item_id),
  foreign key (owner_id, invoice_id) references public.xero_invoices (owner_id, invoice_id) on delete cascade
);

create table if not exists public.xero_bank_transactions (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_transaction_id text not null,
  type text not null,
  status text,
  contact_name text,
  date date,
  reference text,
  bank_account text,
  is_reconciled boolean not null default false,
  has_attachments boolean not null default false,
  line_amount_types text,
  sub_total numeric(14, 2) not null default 0,
  total_tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  lines jsonb not null default '[]'::jsonb,
  updated_utc timestamptz,
  primary key (owner_id, bank_transaction_id)
);

create table if not exists public.xero_accounts (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id text not null,
  code text,
  name text not null,
  type text,
  class text,
  tax_type text,
  status text,
  primary key (owner_id, account_id)
);

create table if not exists public.xero_sync_state (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resource text not null,
  modified_since timestamptz,
  next_page integer,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  primary key (owner_id, resource)
);

create table if not exists public.xero_api_usage (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (owner_id, day)
);

create table if not exists public.xero_report_cache (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  fetched_at timestamptz not null default now(),
  data jsonb not null,
  primary key (owner_id, key)
);

-- Documents Jarvis created in Xero (always as drafts), for tracking and audit
create table if not exists public.xero_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'quote', 'purchase_order', 'contact')),
  xero_id text not null,
  number text,
  contact_name text,
  total numeric(14, 2),
  status text,
  proposal_id uuid,
  created_at timestamptz not null default now()
);

-- ─── Proposals ──────────────────────────────────────────────────────────────
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  number text not null,
  title text not null,
  client_name text not null,
  client_id uuid references public.clients (id) on delete set null,
  xero_contact_id text,
  contact_name text,
  contact_email text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  issue_date date not null default ((now() at time zone 'Europe/London')::date),
  valid_until date,
  intro text,
  sections jsonb not null default '[]'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  terms text,
  deposit_percent smallint check (deposit_percent between 0 and 100),
  template text,
  xero_quote_id text,
  xero_quote_number text,
  crm_lead_id text,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, number)
);

-- ─── Tax tracker ────────────────────────────────────────────────────────────
create table if not exists public.deadline_status (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deadline_key text not null,
  done_at timestamptz not null default now(),
  note text,
  primary key (owner_id, deadline_key)
);
create table if not exists public.tax_rule_verifications (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rule_id text not null,
  verified_at timestamptz not null default now(),
  verified_by text not null,
  note text,
  primary key (owner_id, rule_id)
);

-- ─── Notifications ──────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create table if not exists public.reminders_sent (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reminder_key text not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  primary key (owner_id, reminder_key, channel)
);

-- ─── updated_at triggers ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings', 'journal_entries', 'knowledge_items', 'clients', 'integration_connections', 'proposals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end;
$$;

-- ─── Row Level Security: owner-only on every table ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'journal_entries', 'knowledge_items', 'chat_conversations', 'chat_messages', 'clients',
    'stream_account_map', 'stream_line_overrides', 'integration_connections', 'xero_contacts', 'xero_invoices',
    'xero_invoice_lines', 'xero_bank_transactions', 'xero_accounts', 'xero_sync_state', 'xero_api_usage',
    'xero_report_cache', 'xero_documents', 'proposals', 'deadline_status', 'tax_rule_verifications',
    'push_subscriptions', 'reminders_sent'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ─── Search helpers (security invoker: RLS applies) ────────────────────────
create or replace function public.search_chat_messages(p_query text, p_limit integer default 20)
returns table (conversation_id uuid, conversation_title text, message_id uuid, sender text, sent_at timestamptz, snippet text, rank real)
language sql stable security invoker set search_path = '' as $$
  select m.conversation_id, c.title, m.id, m.sender, m.sent_at,
         ts_headline('english'::regconfig, m.body, q, 'MaxWords=35, MinWords=15, StartSel=«, StopSel=»'),
         ts_rank(m.search, q)
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id,
       websearch_to_tsquery('english'::regconfig, p_query) q
  where m.search @@ q
  order by ts_rank(m.search, q) desc, m.sent_at desc nulls last
  limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.journal_theme_counts(p_from date, p_to date)
returns table (month text, theme text, entries bigint)
language sql stable security invoker set search_path = '' as $$
  select to_char(e.entry_date, 'YYYY-MM'), lower(t), count(*)
  from public.journal_entries e, unnest(e.themes) t
  where e.entry_date between p_from and p_to
  group by 1, 2
  order by 1, 3 desc
$$;

-- Allow the cron runner (service role) to log as 'cron'
alter table public.audit_log drop constraint if exists audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check check (source in ('dashboard', 'mcp', 'system', 'cron'));
