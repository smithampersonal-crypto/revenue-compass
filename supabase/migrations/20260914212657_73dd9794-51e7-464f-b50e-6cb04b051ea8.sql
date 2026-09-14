-- ARC Phase 8F acceptance patch — permanently idempotent stale-upload cleanup.
-- Additive only.

alter table public.document_upload_intents
  add column if not exists cleanup_queued_at timestamptz;

-- Completed queue rows are terminal: ARC storage paths are immutable and never
-- reused, so an existing row (pending, claimed or completed) stays
-- authoritative. The return value now means "new durable work was inserted".
create or replace function public.arc_queue_storage_object(
  p_bucket text,
  p_path text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
begin
  if coalesce(trim(p_path), '') = '' then
    return false;
  end if;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  values (coalesce(nullif(trim(p_bucket), ''), 'arc-source-documents'), p_path, p_reason)
  on conflict (storage_bucket, storage_object_path) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function public.arc_cleanup_stale_upload_intents(p_limit integer default 200)
returns table(intents_processed integer, objects_queued integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v record;
  v_processed integer := 0;
  v_queued integer := 0;
begin
  for v in
    select i.*
      from public.document_upload_intents i
     where i.state in ('pending', 'prepared', 'failed')
       and i.expires_at < now() - interval '15 minutes'
       and i.cleanup_queued_at is null
     order by i.id
       for update skip locked
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    if public.arc_queue_storage_object(
         'arc-source-documents', v.pending_object_path, 'upload_abandoned') then
      v_queued := v_queued + 1;
    end if;

    if v.permanent_object_path is not null
       and not exists (
         select 1 from public.source_documents d
          where d.storage_object_path = v.permanent_object_path
       )
       and public.arc_queue_storage_object(
             'arc-source-documents', v.permanent_object_path, 'upload_abandoned') then
      v_queued := v_queued + 1;
    end if;

    -- Only reached once every required path is durably queued; a failure
    -- before this point aborts the statement and leaves the marker null.
    -- Phase 8E diagnostics are deliberately left untouched.
    update public.document_upload_intents
       set state = 'failed',
           cleanup_queued_at = now(),
           updated_at = now()
     where id = v.id;

    v_processed := v_processed + 1;
  end loop;

  intents_processed := v_processed;
  objects_queued := v_queued;
  return next;
end;
$$;

revoke all on function public.arc_queue_storage_object(text, text, text) from public, anon, authenticated;
revoke all on function public.arc_cleanup_stale_upload_intents(integer) from public, anon, authenticated;
grant execute on function public.arc_queue_storage_object(text, text, text) to service_role;
grant execute on function public.arc_cleanup_stale_upload_intents(integer) to service_role;

-- Already-cleaned rows: their objects are known to be staged, so they must not
-- re-enter the bounded batch and starve newer stale intents.
update public.document_upload_intents i
   set cleanup_queued_at = now()
 where i.cleanup_queued_at is null
   and i.state = 'failed'
   and i.expires_at < now() - interval '15 minutes'
   and exists (
     select 1 from public.storage_deletion_queue q
      where q.storage_object_path = i.pending_object_path
   );