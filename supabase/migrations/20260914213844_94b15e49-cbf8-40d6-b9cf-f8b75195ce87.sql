-- ARC Phase 8F — signed-upload lifetime alignment.
-- Supabase signed upload URLs stay valid for 2h while ARC intents expire at 1h,
-- so physical storage cleanup must wait for capability expiry + 15m grace.
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
       and i.expires_at < now() - interval '1 hour 15 minutes'
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

revoke all on function public.arc_cleanup_stale_upload_intents(integer) from public, anon, authenticated;
grant execute on function public.arc_cleanup_stale_upload_intents(integer) to service_role;