-- ============================================================
-- PATCH 002 · auto-provision auth.users when profiles are created
-- Run AFTER patch-001-email-gate.sql.
-- Idempotent — safe to re-run.
--
-- Why: with shouldCreateUser: false on the client, OTP send fails
-- if the email has no auth.users row yet. To support founders inviting
-- people through the Admin panel, we create a paired auth.users row
-- automatically every time a profile is inserted.
-- ============================================================

create or replace function public.provision_auth_user_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_existing uuid;
  v_new_id uuid;
begin
  -- If a profile is being inserted with an auth_user_id already, nothing to do.
  if new.auth_user_id is not null then
    return new;
  end if;

  -- Look for an existing auth user with the same email (case-insensitive).
  select id into v_existing
  from auth.users
  where lower(email) = lower(new.email)
  limit 1;

  if v_existing is not null then
    new.auth_user_id := v_existing;
    return new;
  end if;

  -- No matching auth user exists yet; create one.
  -- We construct a minimal row directly. This is allowed because the function
  -- runs as security definer (bypasses RLS) but only when triggered by a
  -- founder INSERT into profiles (which itself is gated by the profiles_insert
  -- RLS policy requiring is_founder()).
  v_new_id := gen_random_uuid();
  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_anonymous,
    is_sso_user
  ) values (
    v_new_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    lower(new.email),
    now(),                                 -- pre-confirm so OTP works
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    false,
    false
  );

  -- Auth schema requires a matching row in auth.identities for the user
  -- to actually be able to sign in via email.
  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_new_id,
    jsonb_build_object('sub', v_new_id::text, 'email', lower(new.email), 'email_verified', true),
    'email',
    lower(new.email),
    now(),
    now(),
    now()
  );

  new.auth_user_id := v_new_id;
  return new;
end;
$$;

drop trigger if exists provision_auth_user on public.profiles;
create trigger provision_auth_user
  before insert on public.profiles
  for each row execute function public.provision_auth_user_for_profile();

-- Also handle existing profiles that have no auth_user_id linked.
-- Re-run inserts as updates to fix them retroactively.
do $$
declare
  r record;
  v_existing uuid;
  v_new_id uuid;
begin
  for r in
    select id, email from public.profiles where auth_user_id is null
  loop
    select id into v_existing from auth.users where lower(email) = lower(r.email) limit 1;
    if v_existing is not null then
      update public.profiles set auth_user_id = v_existing where id = r.id;
    else
      v_new_id := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        is_anonymous, is_sso_user
      ) values (
        v_new_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        lower(r.email), now(), now(), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        '{}'::jsonb, false, false
      );
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_new_id,
        jsonb_build_object('sub', v_new_id::text, 'email', lower(r.email), 'email_verified', true),
        'email', lower(r.email),
        now(), now(), now()
      );
      update public.profiles set auth_user_id = v_new_id where id = r.id;
    end if;
  end loop;
end $$;
