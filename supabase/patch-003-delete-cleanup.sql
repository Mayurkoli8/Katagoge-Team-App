-- ============================================================
-- PATCH 003 · cascade auth.users deletion when a profile is deleted
-- Run after patch-002.
-- Idempotent — safe to re-run.
--
-- Why: when a founder deletes a member, we want to remove their auth.users
-- row too so they can't sign in anymore. The reverse direction was already
-- handled (auth.users delete → profiles.auth_user_id set null), but
-- profile delete left an orphan auth user behind, AND in some Supabase
-- configurations this triggered FK errors that blocked the delete.
-- ============================================================

create or replace function public.cleanup_auth_user_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.auth_user_id is not null then
    delete from auth.users where id = old.auth_user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists cleanup_auth_user on public.profiles;
create trigger cleanup_auth_user
  after delete on public.profiles
  for each row execute function public.cleanup_auth_user_on_profile_delete();
