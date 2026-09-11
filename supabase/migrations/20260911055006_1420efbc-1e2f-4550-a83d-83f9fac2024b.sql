create or replace function public.arc_purge_user_guest_data(
  p_user_id uuid,
  p_guest_token_hash text
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'a user is required' using errcode = '22023';
  end if;

  -- Personal data in temporary rows is removed explicitly here. Any row that
  -- becomes associated with this user afterwards is removed by the
  -- guest_workspaces.migrated_user_id ON DELETE CASCADE rule when the auth
  -- identity itself is deleted, so no anonymous copy can survive.
  delete from public.guest_workspaces g
   where g.migrated_user_id = p_user_id
      or (coalesce(trim(p_guest_token_hash), '') <> '' and g.token_hash = p_guest_token_hash);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.arc_purge_user_guest_data(uuid, text) from public, anon, authenticated;
grant execute on function public.arc_purge_user_guest_data(uuid, text) to service_role;