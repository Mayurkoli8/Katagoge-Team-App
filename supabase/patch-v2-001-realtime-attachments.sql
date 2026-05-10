-- ============================================================
-- PATCH V2-001 · Realtime for attachments
-- Fixes: chat attachments not appearing for recipients in real time
-- (recipient's client got the chat_message INSERT before the
--  attachment row existed, so the lookup returned nothing).
-- Idempotent.
-- ============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.attachments;
  exception when duplicate_object then
    null;
  end;
end $$;
