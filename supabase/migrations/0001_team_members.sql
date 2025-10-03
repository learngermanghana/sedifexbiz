-- supabase/migrations/0001_team_members.sql
--
-- Schema objects required for workspace memberships in Supabase.
-- The objects below provide:
--   * Workspace stores (`stores`)
--   * Team member assignments (`team_members`)
--   * Contract/payment tracking per store (`store_contracts`)
--   * A read-optimised view (`team_memberships_view`) that joins the
--     tables and exposes contract fields used by the frontend.
--   * RPC helpers so the web client can resolve memberships via UID
--     or email without exposing the full tables.

set search_path to public;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  company text,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.store_contracts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'active',
  contract_start date,
  contract_end date,
  payment_status text,
  amount_paid numeric(12, 2),
  currency text default 'USD',
  is_current boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  uid text,
  email text,
  role text not null default 'staff',
  status text default 'active',
  contract_status text,
  phone text,
  invited_by text,
  first_signup_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint team_members_role_check check (role in ('owner', 'staff')),
  constraint team_members_identity_check check (uid is not null or email is not null)
);

create index if not exists team_members_uid_idx on public.team_members (uid);
create index if not exists team_members_email_idx on public.team_members (email);
create index if not exists team_members_store_idx on public.team_members (store_id);

create or replace view public.team_memberships_view as
select
  tm.id,
  tm.store_id,
  tm.uid,
  tm.email,
  tm.role,
  tm.status,
  coalesce(tm.contract_status, sc.status) as contract_status,
  tm.phone,
  tm.invited_by,
  tm.first_signup_email,
  tm.created_at,
  tm.updated_at,
  sc.contract_start,
  sc.contract_end,
  sc.payment_status,
  sc.amount_paid,
  sc.currency,
  s.company,
  s.name as store_name
from public.team_members tm
join public.stores s on s.id = tm.store_id
left join public.store_contracts sc
  on sc.store_id = tm.store_id and sc.is_current = true;

create type public.active_team_member_result as (
  member_id uuid,
  store_id uuid,
  status text,
  contract_status text,
  role text,
  email text,
  uid text
);

create or replace function public.get_active_team_membership(
  p_uid text,
  p_email text default null
) returns public.active_team_member_result
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.active_team_member_result;
begin
  select
    tm.id,
    tm.store_id,
    tm.status,
    coalesce(tm.contract_status, sc.status),
    tm.role,
    tm.email,
    tm.uid
  into result
  from public.team_members tm
  join public.stores s on s.id = tm.store_id
  left join public.store_contracts sc
    on sc.store_id = tm.store_id and sc.is_current = true
  where
    (p_uid is not null and tm.uid = p_uid)
    or (p_email is not null and tm.email = p_email)
  order by
    case when p_uid is not null and tm.uid = p_uid then 0 else 1 end,
    tm.updated_at desc
  limit 1;

  return result;
end;
$$;

comment on view public.team_memberships_view is 'Join of team member assignments and current contract metadata for storefronts.';
comment on function public.get_active_team_membership(text, text) is 'Resolve the most relevant membership for a user by UID/email including contract status.';
