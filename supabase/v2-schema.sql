-- ============================================================
-- KATAGOGE V2 SCHEMA (FIXED)
-- Run this AFTER schema.sql + patch-010-reset.sql.
-- Idempotent — safe to re-run.
--
-- Order matters in this file:
--   1. Create ALL tables first (with no cross-table FKs that don't exist yet)
--   2. Add deferred FK constraints
--   3. Helper functions
--   4. Indexes
--   5. RLS policies (these reference tables, so all tables must exist)
--   6. Triggers
--   7. Realtime
--   8. Storage bucket + policies
-- ============================================================

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.attachments (
  id              text primary key,
  uploader_id     text not null references public.profiles(id) on delete cascade,
  report_id       text references public.reports(id) on delete cascade,
  message_id      text references public.messages(id) on delete cascade,
  chat_message_id text,                        -- FK added after chat_messages exists, below
  storage_path    text not null,
  filename        text not null,
  mime_type       text not null,
  size_bytes      bigint not null,
  kind            text not null check (kind in ('image', 'video', 'document')),
  width           integer,
  height          integer,
  created_at      timestamptz not null default now(),
  constraint exactly_one_parent check (
    (case when report_id is not null then 1 else 0 end) +
    (case when message_id is not null then 1 else 0 end) +
    (case when chat_message_id is not null then 1 else 0 end) = 1
  )
);

create table if not exists public.chats (
  id              text primary key,
  kind            text not null check (kind in ('group', 'dm')),
  name            text,
  description     text,
  created_by      text not null references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  archived        boolean not null default false
);

create table if not exists public.chat_members (
  chat_id         text not null references public.chats(id) on delete cascade,
  user_id         text not null references public.profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('member', 'admin')),
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (chat_id, user_id)
);

create table if not exists public.chat_messages (
  id              text primary key,
  chat_id         text not null references public.chats(id) on delete cascade,
  sender_id       text not null references public.profiles(id) on delete cascade,
  body            text not null default '',
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  has_attachments boolean not null default false
);

-- ============================================================
-- 2. DEFERRED FOREIGN KEY (now that chat_messages exists)
-- ============================================================

alter table public.attachments
  drop constraint if exists attachments_chat_message_fk;
alter table public.attachments
  add constraint attachments_chat_message_fk
  foreign key (chat_message_id) references public.chat_messages(id) on delete cascade;

-- ============================================================
-- 3. HELPER FUNCTIONS (used inside RLS policies)
-- ============================================================

create or replace function public.is_chat_member(p_chat_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = p_chat_id
      and user_id = public.current_profile_id()
  );
$$;

-- ============================================================
-- 4. INDEXES
-- ============================================================

create index if not exists idx_attachments_report  on public.attachments(report_id) where report_id is not null;
create index if not exists idx_attachments_message on public.attachments(message_id) where message_id is not null;
create index if not exists idx_attachments_chat    on public.attachments(chat_message_id) where chat_message_id is not null;
create index if not exists idx_chats_kind          on public.chats(kind);
create index if not exists idx_chats_last_msg      on public.chats(last_message_at desc);
create index if not exists idx_chat_members_user   on public.chat_members(user_id);
create index if not exists idx_chat_messages_chat  on public.chat_messages(chat_id, created_at desc);

-- ============================================================
-- 5. ENABLE RLS + POLICIES
-- (every referenced table now exists)
-- ============================================================

alter table public.attachments    enable row level security;
alter table public.chats          enable row level security;
alter table public.chat_members   enable row level security;
alter table public.chat_messages  enable row level security;

-- ATTACHMENTS

drop policy if exists attachments_select on public.attachments;
drop policy if exists attachments_insert on public.attachments;
drop policy if exists attachments_delete on public.attachments;

create policy attachments_select on public.attachments
  for select to authenticated
  using (
    public.is_founder()
    or (
      report_id is not null and exists (
        select 1 from public.reports r
        where r.id = attachments.report_id
          and r.user_id = public.current_profile_id()
      )
    )
    or (
      message_id is not null and exists (
        select 1 from public.messages m
        where m.id = attachments.message_id
          and (
            m.to_type = 'all'
            or (m.to_type = 'individual' and public.current_profile_id() = any(m.to_ids))
            or (m.to_type = 'team' and exists (
              select 1 from public.profiles p
              where p.auth_user_id = auth.uid() and p.team_ids && m.to_ids
            ))
          )
      )
    )
    or (
      chat_message_id is not null and exists (
        select 1 from public.chat_messages cm
        join public.chat_members mem on mem.chat_id = cm.chat_id
        where cm.id = attachments.chat_message_id
          and mem.user_id = public.current_profile_id()
      )
    )
  );

create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (uploader_id = public.current_profile_id());

create policy attachments_delete on public.attachments
  for delete to authenticated
  using (public.is_founder() or uploader_id = public.current_profile_id());

-- CHATS

drop policy if exists chats_select          on public.chats;
drop policy if exists chats_insert_founder  on public.chats;
drop policy if exists chats_update_founder  on public.chats;
drop policy if exists chats_delete_founder  on public.chats;

create policy chats_select on public.chats
  for select to authenticated
  using (public.is_founder() or public.is_chat_member(id));

create policy chats_insert_founder on public.chats
  for insert to authenticated with check (public.is_founder());

create policy chats_update_founder on public.chats
  for update to authenticated
  using (public.is_founder()) with check (public.is_founder());

create policy chats_delete_founder on public.chats
  for delete to authenticated using (public.is_founder());

-- CHAT MEMBERS

drop policy if exists chat_members_select on public.chat_members;
drop policy if exists chat_members_insert_founder on public.chat_members;
drop policy if exists chat_members_update_self on public.chat_members;
drop policy if exists chat_members_delete_founder on public.chat_members;

create policy chat_members_select on public.chat_members
  for select to authenticated
  using (public.is_founder() or public.is_chat_member(chat_id));

create policy chat_members_insert_founder on public.chat_members
  for insert to authenticated with check (public.is_founder());

create policy chat_members_delete_founder on public.chat_members
  for delete to authenticated using (public.is_founder());

create policy chat_members_update_self on public.chat_members
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

-- CHAT MESSAGES

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_update_own on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.is_founder() or public.is_chat_member(chat_id));

create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = public.current_profile_id()
    and (public.is_founder() or public.is_chat_member(chat_id))
  );

create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (sender_id = public.current_profile_id())
  with check (sender_id = public.current_profile_id());

create policy chat_messages_delete on public.chat_messages
  for delete to authenticated
  using (sender_id = public.current_profile_id() or public.is_founder());

-- ============================================================
-- 6. TRIGGERS
-- ============================================================

create or replace function public.bump_chat_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats set last_message_at = new.created_at where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_bump on public.chat_messages;
create trigger chat_messages_bump
  after insert on public.chat_messages
  for each row execute function public.bump_chat_last_message();

-- ============================================================
-- 7. REALTIME
-- ============================================================

-- Add chat_messages to the supabase_realtime publication so the client
-- gets WebSocket push events for INSERT/UPDATE/DELETE.
do $$
begin
  begin
    alter publication supabase_realtime add table public.chat_messages;
  exception when duplicate_object then
    -- already added; ignore
    null;
  end;
end $$;

-- ============================================================
-- 8. STORAGE BUCKET + POLICIES
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400, null)
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400;

drop policy if exists "attachments storage select" on storage.objects;
drop policy if exists "attachments storage insert" on storage.objects;
drop policy if exists "attachments storage delete" on storage.objects;

create policy "attachments storage select" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

create policy "attachments storage insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments');

create policy "attachments storage delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments');

-- ============================================================
-- DONE.
-- ============================================================
