alter table public.guest_workspaces
  add column if not exists migrated_customer_id uuid references public.customers(id),
  add column if not exists migrated_contract_id uuid references public.contracts(id),
  add column if not exists migrated_analysis_id uuid references public.analyses(id),
  add column if not exists migrated_revision_id uuid references public.analysis_revisions(id);

drop function if exists public.arc_migrate_guest_workspace_by_token(text, uuid, text, text, text);

create or replace function public.arc_migrate_guest_workspace_by_token(
  p_token_hash text,
  p_owner_user_id uuid,
  p_expected_lock_version integer,
  p_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
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
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'a customer name is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_contract_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;

  -- The credential hash is the only way in: the browser never supplies the
  -- guest workspace id. The row lock makes the checks below and the whole
  -- migration a single serialized decision.
  select * into v_row
    from public.guest_workspaces g
   where g.token_hash = p_token_hash
   for update;

  if v_row.id is null then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  -- Response-loss retry: the work already exists, so return exactly what the
  -- committed transaction created rather than creating it a second time.
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
  from public.arc_migrate_guest_workspace(
    v_row.id, p_owner_user_id, trim(p_customer_name), trim(p_contract_title), p_contract_number);

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
$function$;

revoke all on function public.arc_migrate_guest_workspace_by_token(text, uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token(text, uuid, integer, text, text, text)
  to service_role;