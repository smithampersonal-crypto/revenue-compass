-- ARC Phase 8F — deletion & operations.
-- Additive only: no accepted Phase 8 behaviour is redesigned.

-- ------------------------------------------------- durable queue helper ----

create or replace function public.arc_queue_storage_object(
  p_bucket text,
  p_path text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(trim(p_path), '') = '' then
    return false;
  end if;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  values (coalesce(nullif(trim(p_bucket), ''), 'arc-source-documents'), p_path, p_reason)
  on conflict (storage_bucket, storage_object_path) do update
     set completed_at = null,
         claimed_at = null,
         attempt_count = 0,
         last_error = null,
         reason = excluded.reason
   where public.storage_deletion_queue.completed_at is not null;

  return true;
end;
$$;

-- ----------------------------------------- queue-before-relational-delete --

-- Every deletion path — trusted RPC, contract cascade, account deletion,
-- guest expiry — passes through these row deletions, so the immutable object
-- reference is always durably queued before ownership disappears.

create or replace function public.arc_queue_source_document_object()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.arc_queue_storage_object(
    old.storage_bucket, old.storage_object_path, 'document_row_deleted');
  return old;
end;
$$;

drop trigger if exists arc_zz_queue_source_document_object on public.source_documents;
create trigger arc_zz_queue_source_document_object
  before delete on public.source_documents
  for each row execute function public.arc_queue_source_document_object();

create or replace function public.arc_queue_upload_intent_objects()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The pending object is only ever transient, so it is always queued.
  perform public.arc_queue_storage_object(
    'arc-source-documents', old.pending_object_path, 'upload_intent_deleted');

  -- A reserved permanent path is only queued when no Source Document owns it;
  -- a finalized document's bytes are never touched by cleanup.
  if old.permanent_object_path is not null
     and not exists (
       select 1 from public.source_documents d
        where d.storage_object_path = old.permanent_object_path
     ) then
    perform public.arc_queue_storage_object(
      'arc-source-documents', old.permanent_object_path, 'upload_intent_deleted');
  end if;

  return old;
end;
$$;

drop trigger if exists arc_zz_queue_upload_intent_objects on public.document_upload_intents;
create trigger arc_zz_queue_upload_intent_objects
  before delete on public.document_upload_intents
  for each row execute function public.arc_queue_upload_intent_objects();

-- --------------------------------------------- abandoned upload cleanup ----

-- Identification is entirely server-authoritative: the intent's own
-- `expires_at` (the approved one-hour TTL) plus a fifteen-minute grace, and its
-- own `state`. A finalized intent is never touched, and no Source Document is
-- ever removed here. Only the intent row lock is taken, and `skip locked`
-- yields to an in-flight finalization, so the accepted lock ordering
-- (contract -> analysis -> upload intents -> revision -> documents) is
-- preserved rather than extended.

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
     order by i.id
       for update skip locked
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    -- Pending bytes are always transient.
    if public.arc_queue_storage_object(
         'arc-source-documents', v.pending_object_path, 'upload_abandoned') then
      v_queued := v_queued + 1;
    end if;

    -- A reserved permanent path that never became a Source Document.
    if v.permanent_object_path is not null
       and not exists (
         select 1 from public.source_documents d
          where d.storage_object_path = v.permanent_object_path
       )
       and public.arc_queue_storage_object(
             'arc-source-documents', v.permanent_object_path, 'upload_abandoned') then
      v_queued := v_queued + 1;
    end if;

    -- Terminal state, so a late retry can never resume abandoned bytes.
    -- Phase 8E diagnostics on the row are deliberately left untouched.
    update public.document_upload_intents
       set state = 'failed', updated_at = now()
     where id = v.id
       and state <> 'failed';

    v_processed := v_processed + 1;
  end loop;

  intents_processed := v_processed;
  objects_queued := v_queued;
  return next;
end;
$$;

-- ------------------------------------------------- maintenance entrypoint --

-- One bounded, idempotent, restart-safe invocation of the database half of
-- ARC maintenance. Each category is isolated: a failure in one never discards
-- the work of another, and the storage drain remains the application worker's
-- job because it must call the private Storage API.

create or replace function public.arc_run_maintenance(p_intent_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_intents integer := 0;
  v_objects integer := 0;
  v_marked integer := 0;
  v_deleted integer := 0;
begin
  begin
    select c.intents_processed, c.objects_queued
      into v_intents, v_objects
      from public.arc_cleanup_stale_upload_intents(p_intent_limit) c;
    v_result := v_result || jsonb_build_object(
      'staleIntentsProcessed', v_intents, 'staleIntentObjectsQueued', v_objects);
  exception when others then
    v_result := v_result || jsonb_build_object('staleIntentsError', sqlstate);
  end;

  begin
    v_marked := public.arc_expire_guest_workspaces();
    v_deleted := public.arc_delete_expired_guest_workspaces();
    v_result := v_result || jsonb_build_object(
      'guestWorkspacesMarkedExpired', v_marked, 'guestWorkspacesDeleted', v_deleted);
  exception when others then
    v_result := v_result || jsonb_build_object('guestExpirationError', sqlstate);
  end;

  return v_result;
end;
$$;

-- ------------------------------------------------------------ privileges ---

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.arc_queue_storage_object(text,text,text)',
    'public.arc_queue_source_document_object()',
    'public.arc_queue_upload_intent_objects()',
    'public.arc_cleanup_stale_upload_intents(integer)',
    'public.arc_run_maintenance(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $grants$;