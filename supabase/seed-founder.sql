-- ============================================================
-- BOOTSTRAP YOUR FIRST FOUNDER(S)
-- 1. Edit the values below to match your real name(s) and email(s).
-- 2. Run this in Supabase SQL Editor.
-- 3. Go to your deployed app and sign in with that email.
--    Supabase will email you a 6-digit code, you enter it,
--    and the trigger from schema.sql links your auth account
--    to this profile automatically.
-- ============================================================

insert into public.profiles (id, email, name, role, title, status, team_ids)
values
  ('founder_001', 'YOUR_EMAIL@example.com',     'YOUR NAME',     'founder', 'CEO', 'active', '{}'),
  ('founder_002', 'COFOUNDER_EMAIL@example.com', 'COFOUNDER NAME', 'founder', 'CTO', 'active', '{}')
on conflict (id) do update set
  email   = excluded.email,
  name    = excluded.name,
  role    = excluded.role,
  title   = excluded.title,
  status  = excluded.status;

-- If you only have one founder, just remove the second row above.
-- You can always add more founders later via the Admin panel inside the app.
