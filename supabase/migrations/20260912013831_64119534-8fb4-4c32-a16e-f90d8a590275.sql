-- ARC amendment-draft lifecycle: reset to source, and discard.
-- Both are trusted, service-role-only transactions. Neither can ever touch a
-- finalized or superseded revision.

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

  -- One lock covers the whole decision.
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

revoke all on function public.arc_reset_amendment_draft(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.arc_discard_amendment_draft(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.arc_reset_amendment_draft(uuid, uuid, integer) to service_role;
grant execute on function public.arc_discard_amendment_draft(uuid, uuid, integer) to service_role;