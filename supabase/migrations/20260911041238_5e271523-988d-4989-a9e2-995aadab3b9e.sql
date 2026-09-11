-- Phase 7F — account deletion + guest physical retention.
-- Both routines are service-role only; authorization for live guest workspaces
-- continues to be `expires_at`, never whether cleanup has run.

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

  -- Personal data in temporary rows must go before auth.users deletion sets
  -- migrated_user_id to null and makes the association unrecoverable.
  delete from public.guest_workspaces g
   where g.migrated_user_id = p_user_id
      or (coalesce(trim(p_guest_token_hash), '') <> '' and g.token_hash = p_guest_token_hash);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.arc_delete_expired_guest_workspaces()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_count integer;
begin
  -- The nine-hour guest lifetime is the retention boundary: an unauthorized
  -- workspace (expires_at in the past) is also no longer recoverable, so the
  -- row itself is deleted. Idempotent migration recovery therefore lasts
  -- exactly as long as the original workspace did.
  delete from public.guest_workspaces g where g.expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.arc_purge_user_guest_data(uuid, text) from public, anon, authenticated;
revoke all on function public.arc_delete_expired_guest_workspaces() from public, anon, authenticated;
grant execute on function public.arc_purge_user_guest_data(uuid, text) to service_role;
grant execute on function public.arc_delete_expired_guest_workspaces() to service_role;