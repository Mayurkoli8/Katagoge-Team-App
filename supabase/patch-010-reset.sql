-- ============================================================
-- PATCH 010 · MASTER RESET
-- Run this once. It supersedes patch-002 and patch-003.
-- Idempotent — safe to re-run.
--
-- WHAT THIS DOES:
--   1. Removes the broken auto-provisioning triggers (patch-002, patch-003)
--      that were creating malformed auth.users rows and breaking OTP.
--   2. Cleans up any malformed auth.users rows those triggers created.
--   3. Keeps the simple, working pattern: auth.users gets created by
--      Supabase itself when the user verifies their first OTP, and the
--      original `handle_new_auth_user` trigger links it to their profile.
--   4. Keeps email_is_registered() so the client can pre-check before
--      sending an OTP code.
-- ============================================================

-- 1. Drop the broken triggers and functions from patch-002/003.
drop trigger if exists provision_auth_user on public.profiles;
drop function if exists public.provision_auth_user_for_profile() cascade;

drop trigger if exists cleanup_auth_user on public.profiles;
drop function if exists public.cleanup_auth_user_on_profile_delete() cascade;

-- 2. Re-create the clean original trigger that links auth.users → profiles
--    on first sign-in (in case patch-002 dropped it).
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

-- 3. Clean up auth.users rows that:
--    (a) were created by the broken patch-002 trigger (have no encrypted_password
--        and no recent sign-in — these are the malformed rows causing
--        "Database error finding user")
--    (b) have no matching profile at all (orphans from earlier failed attempts)
--
-- We're aggressive here because every malformed row is a potential broken login.
-- Strategy: delete any auth.users row whose linked profile has no recent sign-in
-- AND was created by us (we can detect this by checking if confirmation_token
-- is empty and last_sign_in_at is null — Supabase-created OTP users always have
-- a confirmation flow whereas our manual inserts don't).

-- (a) Orphans: auth.users with no matching profile
delete from auth.users au
where not exists (
  select 1 from public.profiles p
  where p.auth_user_id = au.id
     or lower(p.email) = lower(au.email)
);

-- (b) Suspicious rows: auth.users that have never signed in AND have no
--     confirmation tokens in flight. These are the malformed rows from patch-002.
--     Real Supabase-created users have either last_sign_in_at set OR
--     confirmation/recovery tokens during the OTP flow.
delete from auth.users
where last_sign_in_at is null
  and (encrypted_password is null or encrypted_password = '')
  and (confirmation_token is null or confirmation_token = '')
  and (recovery_token is null or recovery_token = '');

-- 4. Unlink any profiles whose auth_user_id points to a now-deleted row.
update public.profiles
   set auth_user_id = null
 where auth_user_id is not null
   and not exists (
     select 1 from auth.users au where au.id = profiles.auth_user_id
   );

-- 5. Re-affirm the email-check function for client-side pre-flight
--    (in case patch-001 wasn't run or got dropped).
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

grant execute on function public.email_is_registered(text) to anon, authenticated;

-- ============================================================
-- POST-CHECKS — run these to verify state is clean
-- ============================================================

-- Should show your founder + any team members you've added.
-- auth_user_id will be NULL for anyone who hasn't signed in yet — that's NORMAL.
-- Once they sign in successfully, the trigger fills it in.
--
--   select id, email, name, role, status, auth_user_id is not null as has_signed_in
--   from public.profiles
--   order by role desc, name;

-- Should show only people who have completed at least one sign-in.
--   select email, last_sign_in_at, created_at from auth.users order by created_at;

-- Should be 0 — no orphan auth users.
--   select count(*) from auth.users au
--   where not exists (select 1 from public.profiles p where lower(p.email) = lower(au.email));

-- ============================================================
-- HOW IT WORKS NOW (clean flow)
-- ============================================================
-- 1. Founder adds a team member via Admin panel → row inserted into profiles
--    with auth_user_id = NULL.
-- 2. Member visits the app, types their email.
-- 3. Client calls email_is_registered() → returns true (their profile exists).
-- 4. Client calls signInWithOtp({ shouldCreateUser: true }).
-- 5. Supabase creates an auth.users row, sends an OTP email.
-- 6. Member enters the code; Supabase verifies it and the
--    on_auth_user_created trigger links auth.users.id → profiles.auth_user_id.
-- 7. App reads the linked profile and lets them in.
--
-- Strangers (no profile row) are blocked at step 3 — the client refuses
-- to send the OTP and shows a clear "not registered" message.
-- ============================================================
