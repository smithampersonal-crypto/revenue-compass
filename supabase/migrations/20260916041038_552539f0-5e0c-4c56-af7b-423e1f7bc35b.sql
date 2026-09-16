-- ARC Phase 9F acceptance patch — arc_affirm_ai_review_scope declares an OUT
-- parameter named lock_version, which made the owner-row bump ambiguous.
-- Additive: same signature, same lock order, same service-role-only grant.

create or replace function public.arc_affirm_ai_review_scope(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_scope text
) returns table(lock_version integer, affirmed_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scopes constant text[] := array['global', 'step_1', 'step_2', 'step_3', 'step_4', 'step_5',
                                    'additional_topics'];
  v_status public.arc_revision_status;
  v_lock integer;
  v_items jsonb;
  v_next jsonb := '[]'::jsonb;
  v_item jsonb;
  v_count integer := 0;
  v_method text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if p_scope is null or not (p_scope = any (v_scopes)) then
    raise exception 'ARC: unknown review scope %', p_scope using errcode = '22023';
  end if;
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: exactly one owner scope is required' using errcode = '22023';
  end if;
  v_method := case when p_scope = 'global' then 'global_all' else 'page_all' end;

  if p_revision_id is not null then
    select r.status, r.lock_version into v_status, v_lock
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = p_revision_id and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: finalized review history cannot be changed' using errcode = '42501';
    end if;
  else
    select g.lock_version into v_lock
      from public.guest_workspaces g
     where g.id = p_guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  select s.review_items into v_items
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_items is null then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) as value loop
    -- Only a yellow affirmation item in scope is resolved. A red issue is
    -- never touched, and no accounting value changes.
    if (v_item ->> 'state') = 'yellow'
       and (p_scope = 'global' or (v_item ->> 'section') = p_scope) then
      v_item := v_item
        || jsonb_build_object('state', 'resolved', 'affirmedAt', v_now, 'affirmedMethod', v_method);
      v_count := v_count + 1;
    end if;
    v_next := v_next || jsonb_build_array(v_item);
  end loop;

  update public.ai_analysis_state s
     set review_items = v_next,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  -- Qualified: the OUT parameter shares the column's name.
  if p_revision_id is not null then
    update public.analysis_revisions r set lock_version = r.lock_version + 1 where r.id = p_revision_id;
  else
    update public.guest_workspaces g set lock_version = g.lock_version + 1 where g.id = p_guest_workspace_id;
  end if;

  lock_version := p_expected_lock_version + 1;
  affirmed_count := v_count;
  return next;
end;
$$;

revoke all on function public.arc_affirm_ai_review_scope(uuid, text, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.arc_affirm_ai_review_scope(uuid, text, uuid, uuid, integer, text) to service_role;