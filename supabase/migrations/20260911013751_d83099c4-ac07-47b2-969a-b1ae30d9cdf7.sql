drop function if exists public.arc_start_amendment_revision(uuid, uuid);

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

  -- One lock covers the whole decision: the existing-draft check, the
  -- provenance check and the insert all happen under it.
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

  revision_id := v_new;
  created := true;
  return next;
end;
$$;

revoke all on function public.arc_start_amendment_revision(uuid, uuid, uuid) from public;
revoke all on function public.arc_start_amendment_revision(uuid, uuid, uuid) from anon;
revoke all on function public.arc_start_amendment_revision(uuid, uuid, uuid) from authenticated;
grant execute on function public.arc_start_amendment_revision(uuid, uuid, uuid) to service_role;