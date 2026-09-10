create or replace function public.arc_create_contract_with_draft(
  p_customer_id uuid,
  p_title text,
  p_contract_number text,
  p_canonical_inputs jsonb,
  p_schema_version text
)
returns table(contract_id uuid, analysis_id uuid, revision_id uuid)
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_contract_id uuid;
  v_analysis_id uuid;
  v_revision_id uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;
  if p_canonical_inputs is null or coalesce(trim(p_schema_version), '') = '' then
    raise exception 'a contract draft requires canonical inputs and a schema version'
      using errcode = '22023';
  end if;

  -- Caller identity and RLS remain authoritative: an unowned customer is not
  -- visible here, so nothing is created.
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'that customer is not in your workspace' using errcode = '42501';
  end if;

  insert into public.contracts (customer_id, title, contract_number)
  values (p_customer_id, trim(p_title), nullif(trim(coalesce(p_contract_number, '')), ''))
  returning id into v_contract_id;

  insert into public.analyses (contract_id)
  values (v_contract_id)
  returning id into v_analysis_id;

  insert into public.analysis_revisions
    (analysis_id, revision_number, canonical_inputs, schema_version)
  values (v_analysis_id, 1, p_canonical_inputs, p_schema_version)
  returning id into v_revision_id;

  contract_id := v_contract_id;
  analysis_id := v_analysis_id;
  revision_id := v_revision_id;
  return next;
end;
$$;

revoke all on function public.arc_create_contract_with_draft(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.arc_create_contract_with_draft(uuid, text, text, jsonb, text) to authenticated, service_role;