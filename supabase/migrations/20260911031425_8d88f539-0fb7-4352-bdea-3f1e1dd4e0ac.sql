create unique index if not exists guest_workspaces_token_hash_key
  on public.guest_workspaces (token_hash);

create or replace function public.arc_migrate_guest_workspace_by_token(
  p_token_hash text,
  p_owner_user_id uuid,
  p_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_guest uuid;
  v_res record;
begin
  if coalesce(trim(p_token_hash), '') = '' or p_owner_user_id is null then
    raise exception 'a guest credential and an owner are required' using errcode = '22023';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'a customer name is required' using errcode = '22023';
  end if;
  if coalesce(trim(p_contract_title), '') = '' then
    raise exception 'a contract title is required' using errcode = '22023';
  end if;

  -- The credential hash is the only way in: the browser never supplies the
  -- guest workspace id. Expiry is enforced here, at authorization time.
  select g.id into v_guest
    from public.guest_workspaces g
   where g.token_hash = p_token_hash
     and g.status = 'active'
     and g.expires_at > now()
   for update;

  if v_guest is null then
    raise exception 'that guest workspace is no longer available' using errcode = '42501';
  end if;

  select * into v_res
  from public.arc_migrate_guest_workspace(
    v_guest, p_owner_user_id, trim(p_customer_name), trim(p_contract_title), p_contract_number);

  customer_id := v_res.customer_id;
  contract_id := v_res.contract_id;
  analysis_id := v_res.analysis_id;
  revision_id := v_res.revision_id;
  return next;
end;
$function$;

revoke all on function public.arc_migrate_guest_workspace_by_token(text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arc_migrate_guest_workspace_by_token(text, uuid, text, text, text)
  to service_role;