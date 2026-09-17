-- ARC Phase 9G — Task 2. Server-owned review events, review-resolution RPCs
-- and stale-source acknowledgment.
--
-- STAGED FOR REVIEW — NOT APPLIED TO THE HOSTED DATABASE.
-- Verified against a local PostgreSQL 17 instance carrying the complete ARC
-- migration history. It is applied to Cloud only after explicit authorization,
-- through the managed migration tool, byte-for-byte as reviewed.
--
-- Additive only: no existing migration is edited, no existing table is
-- rewritten, no data is backfilled and no accounting behaviour changes.
--
-- Authority model, unchanged from Phase 9A–9F:
--   * the AI tables grant nothing at all to `anon` or `authenticated`;
--   * every mutation is a narrow SECURITY DEFINER routine executable only by
--     the service role, and ownership is re-proven inside that routine;
--   * the browser names a target and may state an expected fingerprint as an
--     optimistic-concurrency precondition — it never authors actor identity,
--     timestamps, fingerprints, resolved state or audit rows.
--
-- Nothing here stores source-document text, PDF bytes, prompts, model output
-- or signed URLs.

/* ------------------------------------------- append-only review history */

create table public.ai_review_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid references public.analysis_revisions(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  -- The AI run whose conclusions were under review, when one is known.
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  actor_kind text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  review_item_id text,
  review_target_key text,
  review_section text,
  review_severity text,
  review_fingerprint text,
  manual_red_reason text,
  note text,
  source_set_fingerprint text,
  created_at timestamptz not null default now(),

  constraint ai_review_events_owner_scope_xor
    check ((revision_id is not null) <> (guest_workspace_id is not null)),
  constraint ai_review_events_known_type
    check (event_type in ('yellow_affirmed', 'red_manually_resolved',
                          'review_item_reopened', 'stale_sources_acknowledged')),
  constraint ai_review_events_known_actor_kind
    check (actor_kind in ('authenticated', 'guest')),
  constraint ai_review_events_actor_matches_kind
    check ((actor_kind = 'authenticated') = (actor_user_id is not null)),
  -- Every item event proves which exact reviewed conclusion it applied to.
  constraint ai_review_events_item_context
    check (
      case
        when event_type in ('yellow_affirmed', 'red_manually_resolved', 'review_item_reopened')
          then review_item_id is not null and length(review_item_id) > 0
               and review_fingerprint is not null and length(review_fingerprint) > 0
               and review_severity in ('yellow', 'red')
        else review_item_id is null and review_fingerprint is null and review_severity is null
      end),
  constraint ai_review_events_manual_reason_context
    check (
      case
        when event_type = 'red_manually_resolved'
          then manual_red_reason in ('reviewed_current_treatment', 'outside_source_information',
                                     'not_applicable')
        else manual_red_reason is null and note is null
      end),
  constraint ai_review_events_note_bounds
    check (note is null or length(note) <= 2000),
  constraint ai_review_events_source_context
    check (
      case
        when event_type = 'stale_sources_acknowledged'
          then source_set_fingerprint is not null and length(source_set_fingerprint) = 64
        else source_set_fingerprint is null
      end)
);

comment on table public.ai_review_events is
  'Append-only human-review audit trail. Current mutable review state stays in ai_analysis_state; canonical accounting stays in analysis_revisions.';

create index ai_review_events_by_revision on public.ai_review_events (revision_id, created_at desc)
  where revision_id is not null;
create index ai_review_events_by_guest_workspace
  on public.ai_review_events (guest_workspace_id, created_at desc)
  where guest_workspace_id is not null;

-- Idempotency: one audit row per (scope, action, review item, fingerprint).
create unique index ai_review_events_one_per_item_action on public.ai_review_events
  (coalesce(revision_id, guest_workspace_id), event_type, review_item_id, review_fingerprint)
  where review_item_id is not null;
-- One acknowledgment row per acknowledged source set, per scope.
create unique index ai_review_events_one_per_source_set on public.ai_review_events
  (coalesce(revision_id, guest_workspace_id), source_set_fingerprint)
  where event_type = 'stale_sources_acknowledged';

-- Append-only: history is never edited, and never removed while the analysis
-- it belongs to still exists. Cascaded removal with the parent scope (account
-- deletion, temporary-workspace expiry) remains possible.
create or replace function public.arc_protect_ai_review_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ARC: review history is append-only';
  end if;
  if exists (select 1 from public.analysis_revisions r where r.id = old.revision_id)
     or exists (select 1 from public.guest_workspaces g where g.id = old.guest_workspace_id) then
    raise exception 'ARC: review history cannot be deleted';
  end if;
  return old;
end;
$$;

create trigger ai_review_events_append_only
  before update or delete on public.ai_review_events
  for each row execute function public.arc_protect_ai_review_event();

alter table public.ai_review_events enable row level security;
revoke all on public.ai_review_events from public, anon, authenticated;
grant select, insert on public.ai_review_events to service_role;

/* --------------------------------- current acknowledgment on the sidecar */

alter table public.ai_analysis_state
  add column acknowledged_source_fingerprint text,
  add column source_acknowledged_at timestamptz,
  add column source_acknowledged_by uuid references auth.users(id) on delete set null;

alter table public.ai_analysis_state
  add constraint ai_analysis_state_acknowledgment_complete
  check ((acknowledged_source_fingerprint is null) = (source_acknowledged_at is null));

comment on column public.ai_analysis_state.acknowledged_source_fingerprint is
  'The exact source-set fingerprint the accountant acknowledged. It stops being current the moment the selected source set changes.';

/* ------------------------------------ authoritative source-set identity */

-- The same canonical form the application computes: a JSON array of
-- [documentId, sha256] pairs in stable order, hashed with SHA-256. The server
-- derives it from the selection; no caller may supply it.
create or replace function public.arc_ai_source_set_fingerprint(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_canonical text;
begin
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: exactly one owner scope is required' using errcode = '22023';
  end if;

  select '[' || coalesce(string_agg(format('["%s","%s"]', t.document_id, t.sha256), ','
                                    order by t.document_id, t.sha256), '') || ']'
    into v_canonical
  from (
    select d.id::text as document_id, lower(d.sha256) as sha256
      from public.revision_source_documents rsd
      join public.source_documents d on d.id = rsd.source_document_id
     where p_revision_id is not null and rsd.revision_id = p_revision_id
    union all
    select d.id::text, lower(d.sha256)
      from public.guest_source_document_selections gsd
      join public.source_documents d on d.id = gsd.source_document_id
     where p_guest_workspace_id is not null and gsd.guest_workspace_id = p_guest_workspace_id
  ) t;

  return encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');
end;
$$;

/* ------------------------------------------- owner scope lock + identity */

-- One place proves ownership and takes the owner-row lock, so every review
-- action serialises against the same row in the same order.
create or replace function public.arc_lock_ai_review_scope(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.arc_revision_status;
  v_lock integer;
begin
  if (p_revision_id is not null) = (p_guest_workspace_id is not null) then
    raise exception 'ARC: exactly one owner scope is required' using errcode = '22023';
  end if;

  if p_revision_id is not null then
    if p_owner_user_id is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
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
    return v_lock;
  end if;

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
  return v_lock;
end;
$$;

-- Advances the owner lock exactly once per committed review action.
create or replace function public.arc_bump_ai_review_scope(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_revision_id is not null then
    update public.analysis_revisions r set lock_version = r.lock_version + 1
     where r.id = p_revision_id;
  else
    update public.guest_workspaces g set lock_version = g.lock_version + 1
     where g.id = p_guest_workspace_id;
  end if;
end;
$$;

/* --------------------------------------------------- yellow affirmation */

create or replace function public.arc_affirm_ai_review_item(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_review_item_id text,
  p_expected_review_fingerprint text,
  p_method text default 'individual'
) returns table(lock_version integer, already_resolved boolean, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lock integer;
  v_items jsonb;
  v_item jsonb;
  v_next jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_event uuid;
  v_run uuid;
begin
  if p_method is null or p_method not in ('individual', 'page_all', 'global_all') then
    raise exception 'ARC: unknown affirmation method' using errcode = '22023';
  end if;
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);

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
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = '40001';
  end if;
  if (v_item ->> 'severity') <> 'yellow' then
    raise exception 'ARC: only an affirmation item can be affirmed' using errcode = '22023';
  end if;

  -- Idempotent retry: the identical affirmation is already recorded, so the
  -- second click changes nothing rather than failing a stale lock check.
  if (v_item ->> 'state') = 'resolved' then
    if (v_item -> 'resolution' ->> 'kind') = 'affirmed'
       and (v_item -> 'resolution' ->> 'reviewFingerprint') = p_expected_review_fingerprint then
      select e.id into v_event from public.ai_review_events e
       where e.event_type = 'yellow_affirmed'
         and e.review_item_id = p_review_item_id
         and e.review_fingerprint = p_expected_review_fingerprint
         and coalesce(e.revision_id, e.guest_workspace_id)
             = coalesce(p_revision_id, p_guest_workspace_id);
      lock_version := v_lock;
      already_resolved := true;
      event_id := v_event;
      return next;
      return;
    end if;
    raise exception 'ARC: that review item was already resolved another way' using errcode = '22023';
  end if;
  if (v_item ->> 'state') <> 'yellow' then
    raise exception 'ARC: that review item is not open for affirmation' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  for v_entry in select value from jsonb_array_elements(v_items) value loop
    if (v_entry ->> 'id') = p_review_item_id then
      v_entry := v_entry || jsonb_build_object(
        'state', 'resolved',
        'resolution', jsonb_build_object(
          'kind', 'affirmed', 'at', v_now, 'method', p_method,
          'reviewFingerprint', p_expected_review_fingerprint),
        'affirmedAt', v_now,
        'affirmedMethod', p_method);
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
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when p_revision_id is not null then 'authenticated' else 'guest' end,
    case when p_revision_id is not null then p_owner_user_id else null end,
    'yellow_affirmed', p_review_item_id, v_item ->> 'targetKey', v_item ->> 'section',
    'yellow', p_expected_review_fingerprint)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  already_resolved := false;
  event_id := v_event;
  return next;
end;
$$;

/* ------------------------------------------------ manual red resolution */

create or replace function public.arc_resolve_ai_review_issue(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_review_item_id text,
  p_expected_review_fingerprint text,
  p_reason text,
  p_note text
) returns table(lock_version integer, already_resolved boolean, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = '40001';
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
             = coalesce(p_revision_id, p_guest_workspace_id);
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
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
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
    case when p_revision_id is not null then 'authenticated' else 'guest' end,
    case when p_revision_id is not null then p_owner_user_id else null end,
    'red_manually_resolved', p_review_item_id, v_item ->> 'targetKey', v_item ->> 'section',
    'red', p_expected_review_fingerprint, p_reason, v_note)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  already_resolved := false;
  event_id := v_event;
  return next;
end;
$$;

/* ------------------------------------------ stale-source acknowledgment */

create or replace function public.arc_acknowledge_ai_stale_sources(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_expected_source_set_fingerprint text
) returns table(lock_version integer, source_set_fingerprint text,
                already_acknowledged boolean, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lock integer;
  v_current text;
  v_recorded text;
  v_event uuid;
  v_exists boolean;
begin
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);

  -- Authoritative and server-derived. The browser value is a precondition only.
  v_current := public.arc_ai_source_set_fingerprint(p_revision_id, p_guest_workspace_id);
  if p_expected_source_set_fingerprint is null
     or p_expected_source_set_fingerprint <> v_current then
    raise exception 'ARC: the selected source documents changed since they were displayed'
      using errcode = '40001';
  end if;

  select true, s.acknowledged_source_fingerprint into v_exists, v_recorded
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_exists is not true then
    raise exception 'ARC: this analysis has no AI analysis state' using errcode = '42501';
  end if;

  if v_recorded = v_current then
    select e.id into v_event from public.ai_review_events e
     where e.event_type = 'stale_sources_acknowledged'
       and e.source_set_fingerprint = v_current
       and coalesce(e.revision_id, e.guest_workspace_id)
           = coalesce(p_revision_id, p_guest_workspace_id);
    lock_version := v_lock;
    source_set_fingerprint := v_current;
    already_acknowledged := true;
    event_id := v_event;
    return next;
    return;
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  update public.ai_analysis_state s
     set acknowledged_source_fingerprint = v_current,
         source_acknowledged_at = now(),
         source_acknowledged_by = p_owner_user_id,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, actor_kind, actor_user_id, event_type, source_set_fingerprint)
  values (
    p_revision_id, p_guest_workspace_id,
    case when p_revision_id is not null then 'authenticated' else 'guest' end,
    case when p_revision_id is not null then p_owner_user_id else null end,
    'stale_sources_acknowledged', v_current)
  returning id into v_event;

  perform public.arc_bump_ai_review_scope(p_revision_id, p_guest_workspace_id);

  lock_version := p_expected_lock_version + 1;
  source_set_fingerprint := v_current;
  already_acknowledged := false;
  event_id := v_event;
  return next;
end;
$$;

/* ----------------------------------------------------------- privileges */

revoke all on function public.arc_protect_ai_review_event() from public, anon, authenticated;
revoke all on function public.arc_ai_source_set_fingerprint(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_lock_ai_review_scope(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_bump_ai_review_scope(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_affirm_ai_review_item(uuid, text, uuid, uuid, integer, text, text, text)
  from public, anon, authenticated;
revoke all on function public.arc_resolve_ai_review_issue(uuid, text, uuid, uuid, integer, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.arc_acknowledge_ai_stale_sources(uuid, text, uuid, uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.arc_ai_source_set_fingerprint(uuid, uuid) to service_role;
grant execute on function public.arc_lock_ai_review_scope(uuid, text, uuid, uuid) to service_role;
grant execute on function public.arc_bump_ai_review_scope(uuid, uuid) to service_role;
grant execute on function public.arc_affirm_ai_review_item(uuid, text, uuid, uuid, integer, text, text, text)
  to service_role;
grant execute on function public.arc_resolve_ai_review_issue(uuid, text, uuid, uuid, integer, text, text, text, text)
  to service_role;
grant execute on function public.arc_acknowledge_ai_stale_sources(uuid, text, uuid, uuid, integer, text)
  to service_role;
