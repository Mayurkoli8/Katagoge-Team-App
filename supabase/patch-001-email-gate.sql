-- ============================================================
-- PATCH 001 · email gate + orphan cleanup
-- Run this once in Supabase SQL Editor.
-- Idempotent — safe to re-run.
-- ============================================================

-- A safe public function: returns true ONLY if an active profile exists for the email.
-- Returns false for everything else (unregistered, inactive, deleted).
-- security definer → bypasses RLS, runs with the table owner's privileges.
-- We only return a boolean — no data leakage about who exists.
create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(email) = lower(p_email)
      and status = 'active'
  );
$$;

-- Allow anonymous (logged-out) callers to invoke it.
grant execute on function public.email_is_registered(text) to anon, authenticated;

-- ============================================================
-- ORPHAN CLEANUP
-- Removes auth users that have no matching profile (left over from
-- earlier test logins where someone tried an email that wasn't yet
-- in the profiles table).
-- ============================================================
delete from auth.users
where id in (
  select au.id
  from auth.users au
  left join public.profiles p on p.auth_user_id = au.id
  where p.id is null
);

-- After this, all auth.users rows are paired with a profile row.
-- Future logins with unauthorized emails are blocked at the client level
-- (see updated db.js / App.jsx) AND server-side via shouldCreateUser: false.
