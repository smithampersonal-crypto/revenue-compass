-- ARC Phase 9F — Task 13. Lifecycle and source-state integration. Additive.

/* ------------------------------------------------------------- helpers -- */

create or replace function public.arc_ai_scope_has_active_run(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.ai_runs r
     where ((p_revision_id is not null and r.revision_id = p_revision_id)
         or (p_guest_workspace_id is not null and r.guest_workspace_id = p_guest_workspace_id))
       and r.stage in ('created', 'extracting', 'preflight_ready', 'analyzing', 'validating', 'applying'));
$$;

create or replace function public.arc_guard_ai_source_freeze(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if public.arc_ai_scope_has_active_run(p_revision_id, p_guest_workspace_id) then
    raise exception 'an AI analysis is running for this analysis — try again once it finishes'
      using errcode = '55006';
  end if;
end;
$$;

-- A selected-source change after a successful run means the saved AI work no
-- longer describes the current evidence. Nothing is deleted and no AI call is
-- made: the sidecar is simply marked stale.
create or replace function public.arc_mark_ai_sources_stale(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.ai_analysis_state s
     set source_state = to_jsonb('stale'::text)
   where ((p_revision_id is not null and s.revision_id = p_revision_id)
       or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id))
     and s.last_successful_run_id is not null
     and s.source_state is distinct from to_jsonb('stale'::text);
end;
$$;

/* ------------------------------------------- one-way guest AI re-homing -- */

create or replace function public.arc_protect_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_terminal constant text[] := array['succeeded', 'preflight_failed', 'api_failed',
                                      'response_invalid', 'application_failed'];
  v_probe public.ai_runs;
  v_rehome boolean;
begin
  if tg_op = 'DELETE' then
    if old.openai_started_at is not null or old.stage = any (v_terminal) then
      raise exception 'ARC: completed AI run provenance cannot be deleted';
    end if;
    return old;
  end if;

  -- The single permitted ownership transition: a temporary-workspace run
  -- becomes a saved-revision run when the visitor saves their work.
  v_rehome := old.guest_workspace_id is not null
              and new.guest_workspace_id is null
              and old.revision_id is null
              and new.revision_id is not null;

  if old.stage = any (v_terminal) then
    v_probe := new;
    v_probe.restored_at := old.restored_at;
    v_probe.updated_at := old.updated_at;
    if v_rehome then
      v_probe.revision_id := old.revision_id;
      v_probe.guest_workspace_id := old.guest_workspace_id;
      v_probe.owner_user_id := old.owner_user_id;
    end if;
    if v_probe is distinct from old then
      raise exception 'ARC: a completed AI run is immutable';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or (not v_rehome and (new.revision_id is distinct from old.revision_id
                           or new.guest_workspace_id is distinct from old.guest_workspace_id
                           or new.owner_user_id is distinct from old.owner_user_id))
     or new.guest_token_hash is distinct from old.guest_token_hash
     or new.quota_scope <> old.quota_scope
     or new.source_set_fingerprint <> old.source_set_fingerprint
     or new.pre_run_canonical_inputs is distinct from old.pre_run_canonical_inputs
     or new.pre_run_ai_state is distinct from old.pre_run_ai_state
     or new.model <> old.model
     or new.reasoning_effort <> old.reasoning_effort
     or new.prompt_version <> old.prompt_version
     or new.output_schema_version <> old.output_schema_version
     or new.guidance_registry_hash <> old.guidance_registry_hash
     or new.created_at <> old.created_at then
    raise exception 'ARC: AI run provenance is immutable';
  end if;

  if old.openai_started_at is not null
     and new.openai_started_at is distinct from old.openai_started_at then
    raise exception 'ARC: the OpenAI start stamp is immutable once set';
  end if;

  return new;
end;
$$;

-- A saved guest-funded run keeps quota_scope = 'guest' while gaining the
-- saving account as its owner, so the constraints allow exactly that shape.
alter table public.ai_runs drop constraint if exists ai_runs_quota_scope_identity;
alter table public.ai_runs add constraint ai_runs_quota_scope_identity check (
  (quota_scope = 'authenticated' and owner_user_id is not null)
  or (quota_scope = 'guest' and guest_token_hash is not null));

alter table public.ai_runs drop constraint if exists ai_runs_revision_is_authenticated;
alter table public.ai_runs add constraint ai_runs_revision_has_owner
  check (revision_id is null or owner_user_id is not null);

/* -------------------------------------------- source selection: revision */

create or replace function public.arc_attach_source_document(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
  v_inserted uuid;
begin
  select r.status, r.lock_version into v_status, v_lock
    from public.analysis_revisions r
    join public.analyses a on a.id = r.analysis_id
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
   for update of r;

  if v_status is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can change its source documents'
      using errcode = '42501';
  end if;
  -- The selected set is frozen while a model result can still be applied.
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  insert into public.revision_source_documents (revision_id, source_document_id)
  values (p_revision_id, p_source_document_id)
  on conflict do nothing
  returning source_document_id into v_inserted;

  if v_inserted is null then
    return v_lock;
  end if;

  perform public.arc_mark_ai_sources_stale(p_revision_id, null);
  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$$;

create or replace function public.arc_remove_source_document(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
  v_removed integer;
begin
  select r.status, r.lock_version into v_status, v_lock
    from public.analysis_revisions r
    join public.analyses a on a.id = r.analysis_id
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
   for update of r;

  if v_status is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can change its source documents'
      using errcode = '42501';
  end if;
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock is distinct from p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  delete from public.revision_source_documents
   where revision_id = p_revision_id and source_document_id = p_source_document_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    return v_lock;
  end if;

  perform public.arc_mark_ai_sources_stale(p_revision_id, null);
  update public.analysis_revisions set lock_version = lock_version + 1 where id = p_revision_id;
  return v_lock + 1;
end;
$$;

/* ----------------------------------------------- source selection: guest */

create or replace function public.arc_attach_guest_source_document(
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_guest record;
  v_inserted uuid;
begin
  if coalesce(trim(p_guest_token_hash), '') = '' then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  select * into v_guest from public.guest_workspaces g
   where g.token_hash = p_guest_token_hash
   for update;

  if v_guest.id is null or v_guest.status <> 'active' or v_guest.expires_at <= now() then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  perform public.arc_guard_ai_source_freeze(null, v_guest.id);

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
  end if;

  if not exists (
    select 1 from public.source_documents d
     where d.id = p_source_document_id
       and d.guest_workspace_id = v_guest.id
  ) then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  insert into public.guest_source_document_selections (guest_workspace_id, source_document_id)
  values (v_guest.id, p_source_document_id)
  on conflict do nothing
  returning source_document_id into v_inserted;

  if v_inserted is null then
    return v_guest.lock_version;
  end if;

  perform public.arc_mark_ai_sources_stale(null, v_guest.id);
  update public.guest_workspaces set lock_version = lock_version + 1 where id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$$;

create or replace function public.arc_remove_guest_source_document(
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_guest record;
  v_removed integer;
begin
  if coalesce(trim(p_guest_token_hash), '') = '' then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  select * into v_guest from public.guest_workspaces g
   where g.token_hash = p_guest_token_hash
   for update;

  if v_guest.id is null or v_guest.status <> 'active' or v_guest.expires_at <= now() then
    raise exception 'that temporary workspace is no longer available' using errcode = '42501';
  end if;

  perform public.arc_guard_ai_source_freeze(null, v_guest.id);

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = v_guest.id
     and s.source_document_id = p_source_document_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    return v_guest.lock_version;
  end if;

  perform public.arc_mark_ai_sources_stale(null, v_guest.id);
  update public.guest_workspaces set lock_version = lock_version + 1 where id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$$;

/* ------------------------------- upload finalization that auto-selects -- */

create or replace function public.arc_commit_source_document_upload(
  p_intent_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer
) returns table(
  source_document_id uuid,
  duplicate boolean,
  associated boolean,
  association_conflict boolean,
  lock_version integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v record;
  v_doc uuid;
  v_duplicate boolean;
  v_associated boolean := false;
  v_conflict boolean := false;
  v_lock integer;
  v_guest record;
  v_selected uuid;
begin
  select * into v from public.document_upload_intents i where i.id = p_intent_id for update;
  if v.id is null then
    raise exception 'that upload was not found' using errcode = '42501';
  end if;

  if v.contract_id is not null then
    if p_owner_user_id is null or not exists (
      select 1 from public.contracts ct
      join public.customers c on c.id = ct.customer_id
      where ct.id = v.contract_id and c.owner_user_id = p_owner_user_id
    ) then
      raise exception 'that upload belongs to another account' using errcode = '42501';
    end if;
  else
    if coalesce(trim(p_guest_token_hash), '') = '' or not exists (
      select 1 from public.guest_workspaces g
      where g.id = v.guest_workspace_id
        and g.token_hash = p_guest_token_hash
        and g.status = 'active'
        and g.expires_at > now()
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if v.state = 'finalized' then
    source_document_id := v.resolved_source_document_id;
    duplicate := coalesce(v.is_duplicate, false);
    associated := v.target_revision_id is not null and exists (
      select 1 from public.revision_source_documents rsd
      where rsd.revision_id = v.target_revision_id
        and rsd.source_document_id = v.resolved_source_document_id);
    association_conflict := false;
    select r.lock_version into lock_version from public.analysis_revisions r
      where r.id = v.target_revision_id;
    return next;
    return;
  end if;

  if v.state <> 'prepared' then
    raise exception 'this upload has not been validated yet' using errcode = '22023';
  end if;
  if v.expires_at <= now() then
    raise exception 'that upload has expired' using errcode = '42501';
  end if;

  -- An upload that would automatically join an active run's selected set must
  -- not partially mutate that selection. Nothing at all is committed here.
  if v.target_revision_id is not null then
    perform public.arc_guard_ai_source_freeze(v.target_revision_id, null);
  elsif v.guest_workspace_id is not null then
    perform public.arc_guard_ai_source_freeze(null, v.guest_workspace_id);
  end if;

  v_duplicate := coalesce(v.is_duplicate, false);

  if v_duplicate then
    v_doc := v.resolved_source_document_id;
  else
    insert into public.source_documents (
      id, contract_id, guest_workspace_id, storage_object_path, original_filename,
      display_name, document_type, effective_date, sha256, byte_size, page_count)
    values (
      v.permanent_document_id, v.contract_id, v.guest_workspace_id, v.permanent_object_path,
      v.original_filename, v.display_name, v.document_type, v.effective_date,
      v.validated_sha256, v.validated_byte_size, v.validated_page_count)
    on conflict do nothing
    returning id into v_doc;

    if v_doc is null then
      select d.id into v_doc from public.source_documents d
       where d.sha256 = v.validated_sha256
         and ((v.contract_id is not null and d.contract_id = v.contract_id)
           or (v.guest_workspace_id is not null and d.guest_workspace_id = v.guest_workspace_id));
      if v_doc is null then
        raise exception 'the uploaded document could not be recorded' using errcode = '23505';
      end if;
      insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
      values ('arc-source-documents', v.permanent_object_path, 'duplicate_race')
      on conflict do nothing;
      v_duplicate := true;
    end if;
  end if;

  if v.target_revision_id is not null then
    begin
      v_lock := public.arc_attach_source_document(
        p_owner_user_id, v.target_revision_id, v_doc, p_expected_lock_version);
      v_associated := true;
    exception when sqlstate '40001' then
      v_conflict := true;
      select r.lock_version into v_lock from public.analysis_revisions r
        where r.id = v.target_revision_id;
    end;
  elsif v.guest_workspace_id is not null then
    select * into v_guest from public.guest_workspaces g
      where g.id = v.guest_workspace_id for update;
    if v_guest.lock_version is distinct from p_expected_lock_version then
      v_conflict := true;
      v_lock := v_guest.lock_version;
    else
      insert into public.guest_source_document_selections (guest_workspace_id, source_document_id)
      values (v.guest_workspace_id, v_doc)
      on conflict do nothing
      returning source_document_id into v_selected;
      v_associated := true;
      if v_selected is null then
        v_lock := v_guest.lock_version;
      else
        perform public.arc_mark_ai_sources_stale(null, v.guest_workspace_id);
        update public.guest_workspaces set lock_version = lock_version + 1
          where id = v.guest_workspace_id;
        v_lock := v_guest.lock_version + 1;
      end if;
    end if;
  end if;

  update public.document_upload_intents
     set state = 'finalized', resolved_source_document_id = v_doc, is_duplicate = v_duplicate
   where id = p_intent_id;

  source_document_id := v_doc;
  duplicate := v_duplicate;
  associated := v_associated;
  association_conflict := v_conflict;
  lock_version := v_lock;
  return next;
end;
$$;

/* ---------------------------------------- deleting a selected document -- */

create or replace function public.arc_stage_source_document_deletion(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_source_document_id uuid,
  p_expected_lock_version integer
) returns table(queued boolean, lock_version integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_doc record;
  v_draft record;
  v_guest record;
begin
  select * into v_doc from public.source_documents d
   where d.id = p_source_document_id for update;
  if v_doc.id is null then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  if v_doc.contract_id is not null then
    if p_owner_user_id is null or not exists (
      select 1 from public.contracts ct
      join public.customers c on c.id = ct.customer_id
      where ct.id = v_doc.contract_id and c.owner_user_id = p_owner_user_id
    ) then
      raise exception 'that document belongs to another account' using errcode = '42501';
    end if;
  else
    if coalesce(trim(p_guest_token_hash), '') = '' or not exists (
      select 1 from public.guest_workspaces g
      where g.id = v_doc.guest_workspace_id
        and g.token_hash = p_guest_token_hash
        and g.status = 'active'
        and g.expires_at > now()
    ) then
      raise exception 'that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if public.arc_source_document_in_history(p_source_document_id) then
    raise exception 'this document is part of finalized history and cannot be deleted'
      using errcode = '42501';
  end if;

  lock_version := null;

  if v_doc.contract_id is not null then
    select r.id as revision_id, r.lock_version as observed into v_draft
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.revision_source_documents rsd on rsd.revision_id = r.id
     where a.contract_id = v_doc.contract_id
       and r.status = 'draft'
       and rsd.source_document_id = p_source_document_id
     for update of r;

    if v_draft.revision_id is not null then
      perform public.arc_guard_ai_source_freeze(v_draft.revision_id, null);
      if v_draft.observed is distinct from p_expected_lock_version then
        raise exception 'the draft changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.revision_source_documents rsd
       where rsd.revision_id = v_draft.revision_id
         and rsd.source_document_id = p_source_document_id;
      perform public.arc_mark_ai_sources_stale(v_draft.revision_id, null);
      update public.analysis_revisions r
         set lock_version = r.lock_version + 1
       where r.id = v_draft.revision_id;
      lock_version := v_draft.observed + 1;
    end if;
  else
    select g.id as workspace_id, g.lock_version as observed into v_guest
      from public.guest_workspaces g
     where g.id = v_doc.guest_workspace_id for update;
    if exists (select 1 from public.guest_source_document_selections s
                where s.guest_workspace_id = v_doc.guest_workspace_id
                  and s.source_document_id = p_source_document_id) then
      perform public.arc_guard_ai_source_freeze(null, v_doc.guest_workspace_id);
      if v_guest.observed is distinct from p_expected_lock_version then
        raise exception 'the temporary workspace changed since it was loaded' using errcode = '40001';
      end if;
      delete from public.guest_source_document_selections s
       where s.guest_workspace_id = v_doc.guest_workspace_id
         and s.source_document_id = p_source_document_id;
      perform public.arc_mark_ai_sources_stale(null, v_doc.guest_workspace_id);
      update public.guest_workspaces g
         set lock_version = g.lock_version + 1
       where g.id = v_doc.guest_workspace_id;
      lock_version := v_guest.observed + 1;
    end if;
  end if;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  values (v_doc.storage_bucket, v_doc.storage_object_path, 'document_deleted')
  on conflict do nothing;

  delete from public.source_documents d where d.id = p_source_document_id;

  queued := true;
  return next;
end;
$$;

/* ------------------------------------------- amendment reset / discard -- */

create or replace function public.arc_reset_amendment_draft(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer
) returns table(lock_version integer, schema_version text, source_revision_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_source uuid;
  v_inputs jsonb;
  v_schema text;
begin
  if p_owner_user_id is null or p_revision_id is null or p_expected_lock_version is null then
    raise exception 'owner, revision and expected lock version are required' using errcode = '22023';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current
    from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
    join public.analysis_revisions r on r.analysis_id = a.id
   where r.id = p_revision_id
     and c.owner_user_id = p_owner_user_id
   for update of a;

  if v_analysis_id is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;

  select r.status, r.lock_version, r.supersedes_revision_id
    into v_status, v_lock, v_source
    from public.analysis_revisions r
   where r.id = p_revision_id
   for update;

  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can be reset' using errcode = '42501';
  end if;
  if v_source is null then
    raise exception 'this draft does not continue a finalized revision' using errcode = '22023';
  end if;
  if v_current is distinct from v_source then
    raise exception 'the analysis has moved on since it was loaded' using errcode = '40001';
  end if;
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  select r.canonical_inputs, r.schema_version
    into v_inputs, v_schema
    from public.analysis_revisions r
   where r.id = v_source;

  update public.analysis_revisions r
     set canonical_inputs = v_inputs,
         schema_version = v_schema,
         lock_version = r.lock_version + 1
   where r.id = p_revision_id
     and r.status = 'draft'
     and r.lock_version = p_expected_lock_version;

  if not found then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  -- The abandoned draft's mutable AI sidecar goes with the abandoned work.
  -- The finalized source revision's own AI history is untouched, and the
  -- finalized sidecar is never copied into the draft.
  delete from public.ai_analysis_state s where s.revision_id = p_revision_id;

  lock_version := p_expected_lock_version + 1;
  schema_version := v_schema;
  source_revision_id := v_source;
  return next;
end;
$$;

create or replace function public.arc_discard_amendment_draft(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_source uuid;
begin
  if p_owner_user_id is null or p_revision_id is null or p_expected_lock_version is null then
    raise exception 'owner, revision and expected lock version are required' using errcode = '22023';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current
    from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
    join public.analysis_revisions r on r.analysis_id = a.id
   where r.id = p_revision_id
     and c.owner_user_id = p_owner_user_id
   for update of a;

  if v_analysis_id is null then
    raise exception 'that revision was not found for this owner' using errcode = '42501';
  end if;

  select r.status, r.lock_version, r.supersedes_revision_id
    into v_status, v_lock, v_source
    from public.analysis_revisions r
   where r.id = p_revision_id
   for update;

  if v_status <> 'draft' then
    raise exception 'only an unfinished draft revision can be discarded' using errcode = '42501';
  end if;
  if v_source is null then
    raise exception 'this draft does not continue a finalized revision' using errcode = '22023';
  end if;
  if v_current is distinct from v_source then
    raise exception 'the analysis has moved on since it was loaded' using errcode = '40001';
  end if;
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  delete from public.analysis_revisions r
   where r.id = p_revision_id
     and r.status = 'draft'
     and r.lock_version = p_expected_lock_version;

  if not found then
    raise exception 'the draft changed since it was loaded' using errcode = '40001';
  end if;

  return v_current;
end;
$$;

/* ------------------------------------- deleting a never-finalized draft -- */

create or replace function public.arc_delete_initial_draft_contract(
  p_owner_user_id uuid,
  p_contract_id uuid
)
returns table (deleted_contract_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_contract_id uuid;
  v_analysis_id uuid;
  v_current_finalized uuid;
  v_draft_id uuid;
  v_draft_number integer;
  v_doc record;
begin
  if p_owner_user_id is null or p_contract_id is null then
    raise exception 'an owner and a contract are required' using errcode = '22023';
  end if;

  select c.id into v_contract_id
    from public.contracts c
    join public.customers cu on cu.id = c.customer_id
   where c.id = p_contract_id
     and cu.owner_user_id = p_owner_user_id
   for update of c;

  if v_contract_id is null then
    raise exception 'that contract is not in your workspace' using errcode = '42501';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current_finalized
    from public.analyses a
   where a.contract_id = v_contract_id
   for update;

  if v_analysis_id is null then
    raise exception 'that analysis is no longer available' using errcode = '42501';
  end if;
  if v_current_finalized is not null then
    raise exception 'that analysis has finalized history and cannot be deleted this way'
      using errcode = '42501';
  end if;

  select r.id, r.revision_number
    into v_draft_id, v_draft_number
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id
     and r.status = 'draft'
   for update;

  if v_draft_id is null or v_draft_number <> 1 then
    raise exception 'only an unfinalized first draft can be deleted this way'
      using errcode = '42501';
  end if;

  -- A model result that could still be applied must not have its target
  -- deleted underneath it.
  perform public.arc_guard_ai_source_freeze(v_draft_id, null);

  if exists (
    select 1 from public.analysis_revisions r
     where r.analysis_id = v_analysis_id
       and r.status in ('finalized', 'superseded')
  ) then
    raise exception 'that analysis has finalized history and cannot be deleted this way'
      using errcode = '42501';
  end if;

  for v_doc in
    select d.id, d.storage_bucket, d.storage_object_path
      from public.source_documents d
     where d.contract_id = v_contract_id
     order by d.id
     for update
  loop
    insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
    values (v_doc.storage_bucket, v_doc.storage_object_path, 'initial_draft_contract_deleted')
    on conflict (storage_bucket, storage_object_path) do nothing;
  end loop;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  select 'arc-source-documents', i.pending_object_path, 'initial_draft_contract_deleted'
    from public.document_upload_intents i
   where i.contract_id = v_contract_id
     and i.pending_object_path is not null
  on conflict (storage_bucket, storage_object_path) do nothing;

  insert into public.storage_deletion_queue (storage_bucket, storage_object_path, reason)
  select 'arc-source-documents', i.permanent_object_path, 'initial_draft_contract_deleted'
    from public.document_upload_intents i
   where i.contract_id = v_contract_id
     and i.permanent_object_path is not null
  on conflict (storage_bucket, storage_object_path) do nothing;

  -- ai_analysis_state, ai_runs, ai_run_sources and ai_run_guidance all fall
  -- away through the existing revision/contract cascade.
  delete from public.contracts c where c.id = v_contract_id;

  deleted_contract_id := v_contract_id;
  return next;
end;
$$;

/* ------------------------------------------------- guest migration v3 --- */

create or replace function public.arc_migrate_guest_workspace_v3(
  p_guest_workspace_id uuid,
  p_owner_user_id uuid,
  p_existing_customer_id uuid,
  p_new_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table (
  customer_id uuid,
  contract_id uuid,
  analysis_id uuid,
  revision_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_draft jsonb;
  v_schema_version text;
  v_customer_id uuid;
  v_contract_id uuid;
  v_analysis_id uuid;
  v_revision_id uuid;
  v_selected uuid[];
  v_new_name text := nullif(trim(coalesce(p_new_customer_name, '')), '');
  v_owns boolean;
begin
  if (p_existing_customer_id is not null)::int + (v_new_name is not null)::int <> 1 then
    raise exception 'exactly one of an existing customer or a new customer name is required'
      using errcode = '22023';
  end if;

  select g.draft_json, g.schema_version
    into v_draft, v_schema_version
  from public.guest_workspaces g
  where g.id = p_guest_workspace_id
    and g.status = 'active'
    and g.expires_at > now()
  for update;

  if v_draft is null then
    raise exception 'guest workspace % is not available for migration', p_guest_workspace_id
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'owner % does not exist', p_owner_user_id using errcode = '42501';
  end if;

  -- The owner target of an executing run must never move underneath it.
  if public.arc_ai_scope_has_active_run(null, p_guest_workspace_id) then
    raise exception 'an AI analysis is running for this analysis — try again once it finishes'
      using errcode = '55006';
  end if;

  update public.guest_workspaces
     set status = 'migrating'
   where id = p_guest_workspace_id;

  if p_existing_customer_id is not null then
    select cu.id into v_customer_id
      from public.customers cu
     where cu.id = p_existing_customer_id
       and cu.owner_user_id = p_owner_user_id
     for update;
    if v_customer_id is null then
      raise exception 'that customer is not in your workspace' using errcode = '42501';
    end if;
  else
    insert into public.customers (owner_user_id, name)
    values (p_owner_user_id, v_new_name)
    returning id into v_customer_id;
  end if;

  insert into public.contracts (customer_id, title, contract_number)
  values (v_customer_id, p_contract_title, nullif(trim(coalesce(p_contract_number, '')), ''))
  returning id into v_contract_id;

  insert into public.analyses (contract_id)
  values (v_contract_id)
  returning id into v_analysis_id;

  insert into public.analysis_revisions (analysis_id, revision_number, status, canonical_inputs, schema_version)
  values (v_analysis_id, 1, 'draft', v_draft, v_schema_version)
  returning id into v_revision_id;

  select coalesce(array_agg(s.source_document_id), '{}')
    into v_selected
    from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  update public.source_documents d
     set contract_id = v_contract_id,
         guest_workspace_id = null
   where d.guest_workspace_id = p_guest_workspace_id;

  if array_length(v_selected, 1) is not null then
    insert into public.revision_source_documents (revision_id, source_document_id)
    select v_revision_id, unnest(v_selected)
    on conflict do nothing;
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  -- The destination revision must really belong to the saving account. This is
  -- proven here, not left to the run trigger alone.
  select exists (
    select 1
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = v_revision_id and c.owner_user_id = p_owner_user_id)
    into v_owns;
  if not v_owns then
    raise exception 'the destination revision does not belong to this account' using errcode = '42501';
  end if;

  -- AI history re-homes as-is: same run ids, same stages, same fingerprints,
  -- same quota scope, same guest credential, same timings and metadata.
  update public.ai_runs r
     set revision_id = v_revision_id,
         guest_workspace_id = null,
         owner_user_id = p_owner_user_id
   where r.guest_workspace_id = p_guest_workspace_id;

  update public.ai_analysis_state s
     set revision_id = v_revision_id,
         guest_workspace_id = null
   where s.guest_workspace_id = p_guest_workspace_id;

  update public.guest_workspaces
     set status = 'migrated',
         migrated_user_id = p_owner_user_id
   where id = p_guest_workspace_id;

  customer_id := v_customer_id;
  contract_id := v_contract_id;
  analysis_id := v_analysis_id;
  revision_id := v_revision_id;
  return next;
end;
$$;

create or replace function public.arc_migrate_guest_workspace_by_token_v3(
  p_token_hash text,
  p_owner_user_id uuid,
  p_expected_lock_version integer,
  p_existing_customer_id uuid,
  p_new_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.guest_workspaces%rowtype;
  v_res record;
begin
  if coalesce(trim(p_token_hash), '') = '' or p_owner_user_id is null then
    raise exception 'a guest credential and an owner are required' using errcode = '22023';
  end if;
  if p_expected_lock_version is null or p_expected_lock_version < 1 then
    raise exception 'an expected lock version is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_contract_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;

  select * into v_row
    from public.guest_workspaces g
   where g.token_hash = p_token_hash
   for update;

  if v_row.id is null then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  -- Response-loss retry returns exactly what the committed transaction made.
  -- Nothing is moved twice and no lock advances again.
  if v_row.status = 'migrated' then
    if v_row.migrated_user_id is distinct from p_owner_user_id then
      raise exception 'that guest workspace belongs to another account' using errcode = '42501';
    end if;
    if v_row.migrated_revision_id is null then
      raise exception 'that guest workspace has no recoverable migration result' using errcode = '42501';
    end if;
    customer_id := v_row.migrated_customer_id;
    contract_id := v_row.migrated_contract_id;
    analysis_id := v_row.migrated_analysis_id;
    revision_id := v_row.migrated_revision_id;
    idempotent := true;
    return next;
    return;
  end if;

  if v_row.status <> 'active' or v_row.expires_at <= now() then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  if v_row.lock_version <> p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was confirmed' using errcode = '40001';
  end if;

  select * into v_res
  from public.arc_migrate_guest_workspace_v3(
    v_row.id, p_owner_user_id, p_existing_customer_id, p_new_customer_name,
    trim(p_contract_title), p_contract_number);

  update public.guest_workspaces
     set migrated_customer_id = v_res.customer_id,
         migrated_contract_id = v_res.contract_id,
         migrated_analysis_id = v_res.analysis_id,
         migrated_revision_id = v_res.revision_id
   where id = v_row.id;

  customer_id := v_res.customer_id;
  contract_id := v_res.contract_id;
  analysis_id := v_res.analysis_id;
  revision_id := v_res.revision_id;
  idempotent := false;
  return next;
end;
$$;

/* ------------------------------------------------------------- privileges */

revoke all on function public.arc_ai_scope_has_active_run(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arc_guard_ai_source_freeze(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arc_mark_ai_sources_stale(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arc_migrate_guest_workspace_v3(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.arc_migrate_guest_workspace_by_token_v3(text, uuid, integer, uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.arc_ai_scope_has_active_run(uuid, uuid) to service_role;
grant execute on function public.arc_guard_ai_source_freeze(uuid, uuid) to service_role;
grant execute on function public.arc_mark_ai_sources_stale(uuid, uuid) to service_role;
grant execute on function public.arc_migrate_guest_workspace_v3(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.arc_migrate_guest_workspace_by_token_v3(text, uuid, integer, uuid, text, text, text) to service_role;