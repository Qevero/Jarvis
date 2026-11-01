-- Jarvis · Phase 1: foundations and Company Vault
-- Run in the Supabase SQL editor (or `npx supabase db push`).
-- Every table has Row Level Security; rows belong to the signed-in owner.

-- ─── Company Vault: single-value fields ─────────────────────────────────────
-- Field keys are defined in code (lib/vault/fields.ts). Sensitive fields are
-- encrypted by the app (AES-256-GCM) before they reach the database, so
-- `value_encrypted` is never readable here.
create table if not exists public.company_fields (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value text,
  value_encrypted text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key),
  constraint company_fields_one_value check (value is null or value_encrypted is null)
);

-- ─── Company Vault: list items (directors, insurance, suppliers, subscriptions)
create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('director', 'insurance', 'supplier', 'subscription')),
  name text not null check (length(name) between 1 and 200),
  provider text,
  reference text,
  renewal_date date,
  cost_pence integer check (cost_pence is null or cost_pence >= 0),
  billing_period text check (billing_period in ('monthly', 'quarterly', 'annual', 'one-off')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_owner_kind on public.vault_items (owner_id, kind);

-- ─── Documents (files live in the private "vault" storage bucket) ──────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  category text not null check (category in ('incorporation', 'vat', 'insurance', 'tax', 'banking', 'contract', 'other')),
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);
create index if not exists documents_owner on public.documents (owner_id, uploaded_at desc);

-- ─── Audit log: every write Jarvis makes (append-only) ─────────────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('dashboard', 'mcp', 'system')),
  client_id text,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_owner_time on public.audit_log (owner_id, occurred_at desc);

-- ─── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists company_fields_touch on public.company_fields;
create trigger company_fields_touch before update on public.company_fields
  for each row execute function public.touch_updated_at();
drop trigger if exists vault_items_touch on public.vault_items;
create trigger vault_items_touch before update on public.vault_items
  for each row execute function public.touch_updated_at();

-- ─── Row Level Security ────────────────────────────────────────────────────
alter table public.company_fields enable row level security;
alter table public.vault_items enable row level security;
alter table public.documents enable row level security;
alter table public.audit_log enable row level security;

-- Nothing is readable without signing in.
revoke all on public.company_fields, public.vault_items, public.documents, public.audit_log from anon;

drop policy if exists "owner full access" on public.company_fields;
create policy "owner full access" on public.company_fields for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner full access" on public.vault_items;
create policy "owner full access" on public.vault_items for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner full access" on public.documents;
create policy "owner full access" on public.documents for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Audit log: read and append only. No update or delete policy exists.
drop policy if exists "owner reads" on public.audit_log;
create policy "owner reads" on public.audit_log for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists "owner appends" on public.audit_log;
create policy "owner appends" on public.audit_log for insert to authenticated
  with check (owner_id = (select auth.uid()));
revoke update, delete, truncate on public.audit_log from authenticated;

-- ─── Storage: private "vault" bucket, files under <user id>/ ───────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists "vault owner read" on storage.objects;
create policy "vault owner read" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "vault owner insert" on storage.objects;
create policy "vault owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "vault owner delete" on storage.objects;
create policy "vault owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─── Keep-alive ping (free projects pause after 7 days without activity) ──
-- Returns a constant; exposes no data.
create or replace function public.ping() returns text
language sql stable security definer set search_path = '' as $$ select 'ok'::text $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
