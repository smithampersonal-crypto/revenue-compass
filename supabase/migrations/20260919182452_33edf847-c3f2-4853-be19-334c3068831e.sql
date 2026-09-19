-- ARC Post-R2 Database Hardening — non-retryable conflict SQLSTATE (part 3 of 4
-- of the reviewed staged migration 20260919060000_post_r2_conflict_sqlstate.sql).

CREATE OR REPLACE FUNCTION public.arc_migrate_guest_workspace_by_token_v3(p_token_hash text, p_owner_user_id uuid, p_expected_lock_version integer, p_existing_customer_id uuid, p_new_customer_name text, p_contract_title text, p_contract_number text)
 RETURNS TABLE(customer_id uuid, contract_id uuid, analysis_id uuid, revision_id uuid, idempotent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    raise exception 'the temporary workspace changed since it was confirmed' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_protect_revision_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_parent_analysis uuid;
begin
  -- ---------------- INSERT ----------------
  if tg_op = 'INSERT' then
    if new.status <> 'draft'
       or new.engine_outputs is not null
       or new.reconciliation_snapshot is not null
       or new.engine_version is not null
       or new.finalized_at is not null
       or new.lock_version <> 1 then
      raise exception
        'a new analysis revision must be created as an empty draft (lock version 1)'
        using errcode = '42501';
    end if;

    if new.supersedes_revision_id is not null then
      select analysis_id into v_parent_analysis
        from public.analysis_revisions where id = new.supersedes_revision_id;
      if v_parent_analysis is distinct from new.analysis_id then
        raise exception 'supersedes_revision_id must belong to the same analysis'
          using errcode = '23514';
      end if;
    end if;

    return new;
  end if;

  -- ---------------- UPDATE ----------------
  if tg_op = 'UPDATE' then
    -- identity / lineage columns are frozen for every transition
    if new.id <> old.id
       or new.analysis_id <> old.analysis_id
       or new.revision_number <> old.revision_number
       or new.created_at <> old.created_at then
      raise exception 'analysis revision identity columns are immutable'
        using errcode = '42501';
    end if;

    -- draft -> draft: editable payload + concurrency metadata only
    if old.status = 'draft' and new.status = 'draft' then
      if new.engine_outputs is not null
         or new.reconciliation_snapshot is not null
         or new.engine_version is not null
         or new.finalized_at is not null then
        raise exception 'draft revisions cannot carry finalized outputs'
          using errcode = '42501';
      end if;
      if new.supersedes_revision_id is not distinct from old.supersedes_revision_id then
        new.updated_at := now();
        return new;
      end if;
      raise exception 'supersedes_revision_id cannot be changed on a draft'
        using errcode = '42501';
    end if;

    -- draft -> finalized: only via a complete, trusted snapshot
    if old.status = 'draft' and new.status = 'finalized' then
      if new.engine_outputs is null
         or new.reconciliation_snapshot is null
         or coalesce(trim(new.engine_version), '') = ''
         or coalesce(trim(new.schema_version), '') = ''
         or new.finalized_at is null then
        raise exception
          'finalization requires engine outputs, reconciliation snapshot, versions, and a finalization timestamp'
          using errcode = '22023';
      end if;
      if new.canonical_inputs is distinct from old.canonical_inputs then
        raise exception 'canonical inputs cannot change during finalization'
          using errcode = '42501';
      end if;
      if new.lock_version <> old.lock_version + 1 then
        raise exception 'finalization must advance the lock version exactly once'
          using errcode = 'PT409';
      end if;
      if new.supersedes_revision_id is not null then
        if new.supersedes_revision_id = new.id then
          raise exception 'a revision cannot supersede itself' using errcode = '23514';
        end if;
        select analysis_id into v_parent_analysis
          from public.analysis_revisions where id = new.supersedes_revision_id;
        if v_parent_analysis is distinct from new.analysis_id then
          raise exception 'supersedes_revision_id must belong to the same analysis'
            using errcode = '23514';
        end if;
      end if;
      new.updated_at := now();
      return new;
    end if;

    -- finalized -> superseded: status only, snapshot byte-identical
    if old.status = 'finalized' and new.status = 'superseded'
       and new.canonical_inputs is not distinct from old.canonical_inputs
       and new.engine_outputs is not distinct from old.engine_outputs
       and new.reconciliation_snapshot is not distinct from old.reconciliation_snapshot
       and new.schema_version is not distinct from old.schema_version
       and new.engine_version is not distinct from old.engine_version
       and new.supersedes_revision_id is not distinct from old.supersedes_revision_id
       and new.finalized_at is not distinct from old.finalized_at
       and new.lock_version = old.lock_version
    then
      new.updated_at := now();
      return new;
    end if;

    raise exception
      'analysis revision % cannot transition from % to % in this way',
      old.id, old.status, new.status
      using errcode = '42501';
  end if;

  -- ---------------- DELETE ----------------
  if old.status in ('finalized', 'superseded') then
    if exists (
      select 1
      from public.analyses a
      join public.contracts c on c.id = a.contract_id
      join public.customers cu on cu.id = c.customer_id
      join auth.users u on u.id = cu.owner_user_id
      where a.id = old.analysis_id
    ) then
      raise exception
        'analysis revision % is % and cannot be deleted', old.id, old.status
        using errcode = '42501';
    end if;
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_remove_guest_source_document(p_guest_token_hash text, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  -- Phase 9F: freeze before the selected set can change.
  perform public.arc_guard_ai_source_freeze(null, v_guest.id);

  if v_guest.lock_version is distinct from p_expected_lock_version then
    raise exception 'the temporary workspace changed since it was loaded' using errcode = 'PT409';
  end if;

  -- A cross-workspace request is refused outright, never a silent no-op.
  if not exists (
    select 1 from public.source_documents d
     where d.id = p_source_document_id
       and d.guest_workspace_id = v_guest.id
  ) then
    raise exception 'that document was not found' using errcode = '42501';
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = v_guest.id
     and s.source_document_id = p_source_document_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    return v_guest.lock_version;
  end if;

  -- Phase 9F: the selection really changed, so any AI result is stale.
  perform public.arc_mark_ai_sources_stale(null, v_guest.id);
  update public.guest_workspaces g set lock_version = g.lock_version + 1 where g.id = v_guest.id;
  return v_guest.lock_version + 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_remove_source_document(p_owner_user_id uuid, p_revision_id uuid, p_source_document_id uuid, p_expected_lock_version integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.arc_reset_amendment_draft(p_owner_user_id uuid, p_revision_id uuid, p_expected_lock_version integer)
 RETURNS TABLE(lock_version integer, schema_version text, source_revision_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    raise exception 'the analysis has moved on since it was loaded' using errcode = 'PT409';
  end if;
  -- Phase 9F: a model result that can still be applied freezes the source set.
  perform public.arc_guard_ai_source_freeze(p_revision_id, null);
  -- Rejected before either the inputs or the source set is touched.
  if v_lock <> p_expected_lock_version then
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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
    raise exception 'the draft changed since it was loaded' using errcode = 'PT409';
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

  -- Phase 9F: the abandoned draft's mutable AI sidecar goes with the abandoned
  -- work. The finalized source revision's own AI state is untouched, and the
  -- finalized sidecar is never copied into the draft.
  delete from public.ai_analysis_state s where s.revision_id = p_revision_id;

  lock_version := p_expected_lock_version + 1;
  schema_version := v_schema;
  source_revision_id := v_source;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.arc_resolve_ai_review_issue(p_owner_user_id uuid, p_guest_token_hash text, p_revision_id uuid, p_guest_workspace_id uuid, p_expected_lock_version integer, p_review_item_id text, p_expected_review_fingerprint text, p_reason text, p_note text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lock_version integer, already_resolved boolean, event_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lock integer;
  v_items jsonb;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_event uuid;
  v_run uuid;
  v_actor uuid;
begin
  if p_reason is null or p_reason not in ('reviewed_current_treatment',
                                          'outside_source_information', 'not_applicable') then
    raise exception 'ARC: unknown resolution reason' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'ARC: that note is too long' using errcode = '22023';
  end if;

  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  select s.review_items, s.last_successful_run_id into v_items, v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_items is null then
    raise exception 'ARC: this analysis has no AI review state' using errcode = '42501';
  end if;

  select value into v_item from jsonb_array_elements(v_items) value
   where value ->> 'id' = p_review_item_id;
  if v_item is null then
    raise exception 'ARC: that review item is not part of this analysis' using errcode = '22023';
  end if;
  if (v_item ->> 'reviewFingerprint') is distinct from p_expected_review_fingerprint then
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = 'PT409';
  end if;
  if (v_item ->> 'severity') <> 'red' then
    raise exception 'ARC: only a red review issue can be resolved this way' using errcode = '22023';
  end if;
  -- A deterministic validation or calculation error is ARC's own conclusion.
  -- It is never an AI review item and can never be dismissed by a person.
  if coalesce((v_item ->> 'deterministic')::boolean, false) then
    raise exception 'ARC: a calculation error must be corrected, not dismissed'
      using errcode = '22023';
  end if;

  if (v_item ->> 'state') = 'resolved' then
    if (v_item -> 'resolution' ->> 'kind') = 'manual_red'
       and (v_item -> 'resolution' ->> 'reviewFingerprint') = p_expected_review_fingerprint
       and (v_item -> 'resolution' ->> 'reason') = p_reason
       and (v_item -> 'resolution' ->> 'note') is not distinct from v_note then
      select e.id into v_event from public.ai_review_events e
       where e.event_type = 'red_manually_resolved'
         and e.review_item_id = p_review_item_id
         and e.review_fingerprint = p_expected_review_fingerprint
         and coalesce(e.revision_id, e.guest_workspace_id)
             = coalesce(p_revision_id, p_guest_workspace_id)
       order by e.event_seq desc
       limit 1;
      lock_version := v_lock;
      already_resolved := true;
      event_id := v_event;
      return next;
      return;
    end if;
    raise exception 'ARC: that review item was already resolved another way' using errcode = '22023';
  end if;
  if (v_item ->> 'state') <> 'red' then
    raise exception 'ARC: that review item is not open' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = 'PT409';
  end if;

  for v_entry in select value from jsonb_array_elements(v_items) value loop
    if (v_entry ->> 'id') = p_review_item_id then
      v_entry := v_entry || jsonb_build_object(
        'state', 'resolved',
        'resolution', jsonb_build_object(
          'kind', 'manual_red', 'at', v_now, 'reason', p_reason,
          'note', to_jsonb(v_note), 'reviewFingerprint', p_expected_review_fingerprint));
    end if;
    v_next := v_next || jsonb_build_array(v_entry);
  end loop;

  update public.ai_analysis_state s
     set review_items = v_next,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint,
    manual_red_reason, note)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
    'red_manually_resolved', p_review_item_id, v_item ->> 'targetKey', v_item ->> 'section',
    'red', p_expected_review_fingerprint, p_reason, v_note)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  already_resolved := false;
  event_id := v_event;
  return next;
end;
$function$
;