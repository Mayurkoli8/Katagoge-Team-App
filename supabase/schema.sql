-- ============================================================
-- KATAGOGE · DATABASE SCHEMA
-- Run this entire file in Supabase SQL Editor (one shot is fine).
-- Idempotent — safe to re-run.
-- ============================================================

-- ---------- TABLES ----------

create table if not exists public.profiles (
  id              text primary key,            -- our own user id, e.g. "user_xxx" or "founder_xxx"
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  email           text not null unique,
  name            text not null,
  role            text not null check (role in ('founder', 'team')),
  position        text,                        -- "Employee", "Contractor", "Intern", "Part-time" (team only)
  title           text,                        -- "CEO", "CTO", etc. (founder only)
  status          text not null default 'active' check (status in ('active', 'inactive')),
  team_ids        text[] not null default '{}',
  created_at      timestamptz not null default now()
);

create table if not exists public.teams (
  id              text primary key,
  name            text not null,
  description     text default '',
  created_at      timestamptz not null default now()
);

create table if not exists public.reports (
  id                text primary key,
  user_id           text not null references public.profiles(id) on delete cascade,
  week_id           text not null,             -- ISO week, e.g. "2026-W18"
  submitted_at      timestamptz not null default now(),
  updated_at        timestamptz,
  last_week         text not null,
  this_week         text not null,
  blockers          text default '',
  has_blockers      boolean not null default false,
  is_late           boolean not null default false,
  blocker_resolved  boolean not null default false,
  unique(user_id, week_id)
);

create table if not exists public.messages (
  id              text primary key,
  from_user_id    text not null references public.profiles(id) on delete cascade,
  from_name       text not null,
  to_type         text not null check (to_type in ('all', 'team', 'individual')),
  to_ids          text[] not null default '{}',
  type            text not null check (type in ('message', 'announcement', 'task')),
  subject         text not null,
  body            text not null,
  priority        text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  read_by         text[] not null default '{}',
  due_date        timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_reports_user      on public.reports(user_id);
create index if not exists idx_reports_week      on public.reports(week_id);
create index if not exists idx_messages_created  on public.messages(created_at desc);

-- ---------- HELPER: is current user a founder? ----------

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid()
      and role = 'founder'
      and status = 'active'
  );
$$;

create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1;
$$;

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles enable row level security;
alter table public.teams    enable row level security;
alter table public.reports  enable row level security;
alter table public.messages enable row level security;

-- profiles: everyone signed in can read profiles (needed to show names on reports/messages).
-- Only founders can insert/update/delete others. Anyone can update their own auth_user_id link.
drop policy if exists profiles_select       on public.profiles;
drop policy if exists profiles_insert       on public.profiles;
drop policy if exists profiles_update_self  on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_delete       on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_founder());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());

create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_founder());

-- teams: everyone reads. Only founders write.
drop policy if exists teams_select on public.teams;
drop policy if exists teams_write  on public.teams;

create policy teams_select on public.teams
  for select to authenticated using (true);

create policy teams_write on public.teams
  for all to authenticated
  using (public.is_founder())
  with check (public.is_founder());

-- reports: founders can read all, members can read their own.
-- Members can write their own. Founders can update any (e.g. mark blocker resolved).
drop policy if exists reports_select_self    on public.reports;
drop policy if exists reports_select_founder on public.reports;
drop policy if exists reports_insert_self    on public.reports;
drop policy if exists reports_update_self    on public.reports;
drop policy if exists reports_update_founder on public.reports;
drop policy if exists reports_delete_founder on public.reports;

create policy reports_select_self on public.reports
  for select to authenticated
  using (user_id = public.current_profile_id());

create policy reports_select_founder on public.reports
  for select to authenticated using (public.is_founder());

create policy reports_insert_self on public.reports
  for insert to authenticated
  with check (user_id = public.current_profile_id());

create policy reports_update_self on public.reports
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy reports_update_founder on public.reports
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());

create policy reports_delete_founder on public.reports
  for delete to authenticated using (public.is_founder());

-- messages: founders see all and write all. Team members see only those addressed to them.
-- Team members can update read_by on their own messages (mark as read).
drop policy if exists messages_select_recipient on public.messages;
drop policy if exists messages_select_founder   on public.messages;
drop policy if exists messages_insert_founder   on public.messages;
drop policy if exists messages_update_read      on public.messages;
drop policy if exists messages_update_founder   on public.messages;
drop policy if exists messages_delete_founder   on public.messages;

create policy messages_select_recipient on public.messages
  for select to authenticated
  using (
    to_type = 'all'
    or (to_type = 'individual' and public.current_profile_id() = any(to_ids))
    or (to_type = 'team' and exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.team_ids && to_ids
    ))
  );

create policy messages_select_founder on public.messages
  for select to authenticated using (public.is_founder());

create policy messages_insert_founder on public.messages
  for insert to authenticated with check (public.is_founder());

-- Members updating only the read_by array on messages they can see is hard to express in pure RLS.
-- We allow any authenticated user to update read_by IF they can already see the row (handled by select policy).
-- The client will only ever set read_by to include their own profile id; we trust the auth boundary here.
create policy messages_update_read on public.messages
  for update to authenticated
  using (
    to_type = 'all'
    or (to_type = 'individual' and public.current_profile_id() = any(to_ids))
    or (to_type = 'team' and exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.team_ids && to_ids
    ))
  )
  with check (true);

create policy messages_update_founder on public.messages
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());

create policy messages_delete_founder on public.messages
  for delete to authenticated using (public.is_founder());

-- ---------- AUTO-LINK AUTH USER TO PROFILE ON SIGN-IN ----------
-- When a new auth.users row is created (after first OTP verification), if its email matches
-- a profile that has no auth_user_id yet, link them. This makes the "invite by email" flow work
-- without any backend code.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------- SEED TEAMS ----------
-- Adjust to taste. You can also add/edit teams from the Admin panel later.

insert into public.teams (id, name, description) values
  ('team_eng',       'Engineering', 'Product & infra'),
  ('team_design',    'Design',      'Brand & product design'),
  ('team_marketing', 'Marketing',   'Growth & content'),
  ('team_ops',       'Operations',  'Finance, HR, legal')
on conflict (id) do nothing;

-- ============================================================
-- AFTER RUNNING THIS:
--   1. Bootstrap your founder account by running the contents of seed-founder.sql
--      after editing it with your real name and email.
--   2. In Supabase dashboard: Authentication > Providers > Email,
--      ensure "Email" provider is enabled, "Confirm email" is OFF
--      (we use OTP, not confirmation links).
-- ============================================================
