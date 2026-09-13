-- ARC Phase 8D — revision source provenance.

create or replace function public.arc_start_amendment_revision(
  p_owner_user_id uuid,
  p_contract_id uuid,
  p_expected_source_revision_id uuid
)
returns table(revision_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_analysis_id uuid;
  v_current uuid;
  v_existing uuid;
  v_next integer;
  v_inputs jsonb;
  v_schema text;
  v_new uuid;
begin
  if p_owner_user_id is null or p_contract_id is null or p_expected_source_revision_id is null then
    raise exception 'owner, contract and expected source revision are required' using errcode = '22023';
  end if;

  select a.id, a.current_finalized_revision_id
    into v_analysis_id, v_current
    from public.analyses a
    join public.contracts ct on ct.id = a.contract_id
    join public.customers c on c.id = ct.customer_id
   where a.contract_id = p_contract_id
     and c.owner_user_id = p_owner_user_id
   for update of a;

  if v_analysis_id is null then
    raise exception 'that contract was not found for this owner' using errcode = '42501';
  end if;

  select r.id into v_existing
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id
     and r.status = 'draft'
   limit 1;

  if v_existing is not null then
    -- Idempotent retry: the active draft is returned untouched. Its source set
    -- is the accountant's working selection and is never re-copied, and its
    -- lock version is not bumped.
    revision_id := v_existing;
    created := false;
    return next;
    return;
  end if;

  if v_current is null then
    raise exception 'this analysis has no finalized revision to continue from' using errcode = '22023';
  end if;

  if v_current is distinct from p_expected_source_revision_id then
    raise exception 'the analysis has moved on since it was loaded (expected source %, found %)',
      p_expected_source_revision_id, v_current using errcode = '40001';
  end if;

  select r.canonical_inputs, r.schema_version
    into v_inputs, v_schema
    from public.analysis_revisions r
   where r.id = v_current;

  select coalesce(max(r.revision_number), 0) + 1
    into v_next
    from public.analysis_revisions r
   where r.analysis_id = v_analysis_id;

  insert into public.analysis_revisions (
    analysis_id, revision_number, status, supersedes_revision_id,
    canonical_inputs, schema_version, lock_version
  ) values (
    v_analysis_id, v_next, 'draft', v_current, v_inputs, v_schema, 1
  )
  returning id into v_new;

  -- Associations only. Documents and Storage objects are shared, never copied.
  insert into public.revision_source_documents (revision_id, source_document_id)
  select v_new, rsd.source_document_id
    from public.revision_source_documents rsd
   where rsd.revision_id = v_current;

  revision_id := v_new;
  created := true;
  return next;
end;
$$;

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
  -- Rejected before either the inputs or the source set is touched.
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

  -- Same transaction, same single lock advance: the draft's source set becomes
  -- exactly the source revision's set. Draft-only documents stay in the
  -- contract library; only the association is removed.
  delete from public.revision_source_documents rsd
   where rsd.revision_id = p_revision_id
     and rsd.source_document_id not in (
       select s.source_document_id
         from public.revision_source_documents s
        where s.revision_id = v_source
     );

  insert into public.revision_source_documents (revision_id, source_document_id)
  select p_revision_id, s.source_document_id
    from public.revision_source_documents s
   where s.revision_id = v_source
  on conflict do nothing;

  lock_version := p_expected_lock_version + 1;
  schema_version := v_schema;
  source_revision_id := v_source;
  return next;
end;
$$;

create or replace function public.arc_finalize_revision(
  p_owner_user_id uuid,
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_engine_outputs jsonb,
  p_reconciliation_snapshot jsonb,
  p_schema_version text,
  p_engine_version text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_analysis_id uuid;
  v_owner uuid;
  v_status public.arc_revision_status;
  v_lock integer;
  v_current uuid;
begin
  if p_engine_outputs is null or p_reconciliation_snapshot is null
     or coalesce(trim(p_schema_version), '') = ''
     or coalesce(trim(p_engine_version), '') = '' then
    raise exception 'finalization requires engine outputs, reconciliation snapshot, and version metadata'
      using errcode = '22023';
  end if;

  select r.analysis_id into v_analysis_id
  from public.analysis_revisions r
  where r.id = p_revision_id;

  if v_analysis_id is null then
    raise exception 'revision % not found', p_revision_id using errcode = 'P0002';
  end if;

  select a.current_finalized_revision_id into v_current
  from public.analyses a
  where a.id = v_analysis_id
  for update;

  select r.status, r.lock_version, cu.owner_user_id
    into v_status, v_lock, v_owner
  from public.analysis_revisions r
  join public.analyses a on a.id = r.analysis_id
  join public.contracts ct on ct.id = a.contract_id
  join public.customers cu on cu.id = ct.customer_id
  where r.id = p_revision_id
  for update of r;

  if v_owner is distinct from p_owner_user_id then
    raise exception 'revision % is not owned by the caller', p_revision_id using errcode = '42501';
  end if;

  if v_status <> 'draft' then
    raise exception 'revision % is % and cannot be finalized', p_revision_id, v_status
      using errcode = '22023';
  end if;

  if v_lock is distinct from p_expected_lock_version then
    raise exception 'revision % has changed since it was loaded (expected lock version %, found %)',
      p_revision_id, p_expected_lock_version, v_lock using errcode = '40001';
  end if;

  -- Freeze the selected source set: every selected document row is locked, in
  -- document-id order, before the revision leaves 'draft'. A concurrent
  -- metadata edit or delete cannot cross the historical boundary.
  perform 1
  from public.source_documents d
  where d.id in (
    select rsd.source_document_id
    from public.revision_source_documents rsd
    where rsd.revision_id = p_revision_id
  )
  order by d.id
  for update;

  update public.analysis_revisions
     set status = 'finalized',
         engine_outputs = p_engine_outputs,
         reconciliation_snapshot = p_reconciliation_snapshot,
         schema_version = p_schema_version,
         engine_version = p_engine_version,
         supersedes_revision_id = case
           when v_current is not null and v_current <> p_revision_id then v_current
           else supersedes_revision_id end,
         finalized_at = now(),
         lock_version = lock_version + 1
   where id = p_revision_id;

  if v_current is not null and v_current <> p_revision_id then
    update public.analysis_revisions
       set status = 'superseded'
     where id = v_current and status = 'finalized';
  end if;

  update public.analyses
     set current_finalized_revision_id = p_revision_id
   where id = v_analysis_id;

  return p_revision_id;
end;
$$;

revoke all on function public.arc_start_amendment_revision(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.arc_start_amendment_revision(uuid, uuid, uuid) to service_role;

revoke all on function public.arc_reset_amendment_draft(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.arc_reset_amendment_draft(uuid, uuid, integer) to service_role;

revoke all on function public.arc_finalize_revision(uuid, uuid, integer, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_finalize_revision(uuid, uuid, integer, jsonb, jsonb, text, text)
  to service_role;