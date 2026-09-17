-- ARC Phase 9G — Task 2. Server-owned review events, review-resolution RPCs
-- and stale-source acknowledgment.
--
-- STAGED FOR REVIEW — NOT APPLIED TO THE HOSTED DATABASE.
-- Verified against a local PostgreSQL 17 instance carrying the complete ARC
-- migration history. It is applied to Cloud only after explicit authorization,
-- through the managed migration tool, byte-for-byte as reviewed.
--
-- No existing migration file is edited and no data is backfilled. Three
-- existing trusted routines are superseded in place (create or replace) and
-- two unaudited Phase 9F review-mutation routines are retired, so that after
-- this migration there is exactly one authoritative, audited way to change
-- human review state.
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

/* --------------------------- retire the unaudited review-mutation paths */

-- Both predate the audited Task 2 model and have no application caller.
-- `arc_set_ai_review_state` could replace the whole review array; the scope
-- affirmation could resolve yellow items without writing any audit event.
-- Keeping either would leave an authoritative mutation path around the audit
-- trail, so they are retired rather than narrowed.
drop function if exists public.arc_set_ai_review_state(uuid, text, uuid, uuid, integer, jsonb);
drop function if exists public.arc_affirm_ai_review_scope(uuid, text, uuid, uuid, integer, text);

/* ------------------------------------------- append-only review history */

create table public.ai_review_events (
  id uuid primary key default gen_random_uuid(),
  -- Strictly increasing arrival order. `created_at` is the transaction
  -- timestamp and cannot order two events written in one transaction, so
  -- "the most recent matching event" is resolved by this column alone.
  event_seq bigint generated always as identity,
  revision_id uuid references public.analysis_revisions(id) on delete cascade,
  guest_workspace_id uuid references public.guest_workspaces(id) on delete cascade,
  -- Immutable snapshot identifiers, deliberately NOT foreign keys: an audit
  -- row must keep the run and the person that existed when the action was
  -- taken. A referential action such as ON DELETE SET NULL is itself an UPDATE
  -- and would collide with append-only history (and with the actor/kind
  -- agreement constraint) during account deletion and run cleanup.
  ai_run_id uuid,
  actor_kind text not null,
  actor_user_id uuid,
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
  -- 'system' is reserved for reconciliation-driven reopen events, which no
  -- person performs.
  constraint ai_review_events_known_actor_kind
    check (actor_kind in ('authenticated', 'guest', 'system')),
  constraint ai_review_events_actor_matches_kind
    check ((actor_kind = 'authenticated') = (actor_user_id is not null)),
  constraint ai_review_events_system_actor_is_reconciliation
    check (actor_kind <> 'system' or event_type = 'review_item_reopened'),
  constraint ai_review_events_reopen_is_system
    check (event_type <> 'review_item_reopened' or actor_kind = 'system'),
  -- Every item event proves which exact reviewed conclusion it applied to,
  -- and where in the workflow that conclusion lives.
  constraint ai_review_events_item_context
    check (
      case
        when event_type in ('yellow_affirmed', 'red_manually_resolved', 'review_item_reopened')
          then review_item_id is not null and length(btrim(review_item_id)) > 0
               and review_fingerprint is not null and length(btrim(review_fingerprint)) > 0
               and review_target_key is not null and length(btrim(review_target_key)) > 0
               and review_section in ('step_1', 'step_2', 'step_3', 'step_4', 'step_5',
                                      'additional_topics')
               and review_severity in ('yellow', 'red')
        else review_item_id is null and review_fingerprint is null and review_severity is null
             and review_target_key is null and review_section is null
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

-- History is intentionally NOT unique per (scope, action, item, fingerprint).
-- A conclusion can legitimately be reviewed, reopened by re-analysis and
-- reviewed again later, and each of those is its own immutable audit fact.
-- Duplicate-click and response-loss protection comes from the owner-row lock
-- plus the current resolved state, not from a lifetime uniqueness rule. This
-- index only makes "the most recent matching event" a cheap lookup.
create index ai_review_events_item_history on public.ai_review_events
  (coalesce(revision_id, guest_workspace_id), review_item_id, event_type, event_seq desc)
  where review_item_id is not null;
create index ai_review_events_source_history on public.ai_review_events
  (coalesce(revision_id, guest_workspace_id), source_set_fingerprint, event_seq desc)
  where event_type = 'stale_sources_acknowledged';

-- Append-only: history is never edited and never removed while the analysis it
-- belongs to still exists. Cascaded removal with the parent scope (account
-- deletion, unsaved temporary-workspace expiry) remains possible.
--
-- The single exception is the trusted ownership re-home performed by
-- "Save to My Contracts": the same event row moves from the temporary
-- workspace to the newly created revision. It is gated on a transaction-local
-- flag that only the trusted migration routine sets, and every other column —
-- including the event id, actor, timestamp, reason and note — must be
-- byte-identical. The table also grants no UPDATE to any role, so this path is
-- reachable only from a SECURITY DEFINER routine.
create or replace function public.arc_protect_ai_review_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('arc.review_event_rehome', true), 'off') = 'on'
       and old.guest_workspace_id is not null and old.revision_id is null
       and new.guest_workspace_id is null and new.revision_id is not null
       and (to_jsonb(new) - 'revision_id' - 'guest_workspace_id')
           = (to_jsonb(old) - 'revision_id' - 'guest_workspace_id') then
      return new;
    end if;
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
  'The exact source-set fingerprint the accountant acknowledged. It is cleared the moment the selected source set changes or a new analysis succeeds.';

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

-- Ownership and actor identity are different things. A temporary workspace is
-- always owned by its credential, but a signed-in accountant working inside
-- one is a named actor and the audit trail must say so. The actor is taken
-- from the verified session by the server; nothing here comes from the
-- browser, and an unknown user id is refused rather than recorded.
create or replace function public.arc_ai_review_actor(
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_revision_id uuid
) returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid;
begin
  if p_revision_id is not null then
    v_actor := p_owner_user_id;
  else
    v_actor := p_actor_user_id;
  end if;
  if v_actor is null then
    return null;
  end if;
  if not exists (select 1 from auth.users u where u.id = v_actor) then
    raise exception 'ARC: that review action has no valid actor' using errcode = '42501';
  end if;
  return v_actor;
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
  p_method text default 'individual',
  p_actor_user_id uuid default null
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
  v_actor uuid;
begin
  if p_method is null or p_method not in ('individual', 'page_all', 'global_all') then
    raise exception 'ARC: unknown affirmation method' using errcode = '22023';
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
    raise exception 'ARC: this conclusion changed since it was displayed' using errcode = '40001';
  end if;
  if (v_item ->> 'severity') <> 'yellow' then
    raise exception 'ARC: only an affirmation item can be affirmed' using errcode = '22023';
  end if;

  -- Idempotent retry: the identical affirmation is already recorded, so the
  -- second click changes nothing rather than failing a stale lock check. The
  -- same conclusion may have been reviewed in an earlier cycle too, so the
  -- most recent matching event is the one this retry refers to.
  if (v_item ->> 'state') = 'resolved' then
    if (v_item -> 'resolution' ->> 'kind') = 'affirmed'
       and (v_item -> 'resolution' ->> 'reviewFingerprint') = p_expected_review_fingerprint then
      select e.id into v_event from public.ai_review_events e
       where e.event_type = 'yellow_affirmed'
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
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
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
  p_note text,
  p_actor_user_id uuid default null
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
$$;

/* ------------------------------------------ stale-source acknowledgment */

-- Acknowledging stale sources is only meaningful when there is a previous
-- successful analysis AND the selected source set has moved on since it ran.
-- The acknowledgment is recorded against that analysis.
create or replace function public.arc_acknowledge_ai_stale_sources(
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_revision_id uuid,
  p_guest_workspace_id uuid,
  p_expected_lock_version integer,
  p_expected_source_set_fingerprint text,
  p_actor_user_id uuid default null
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
  v_state text;
  v_run uuid;
  v_actor uuid;
begin
  v_lock := public.arc_lock_ai_review_scope(p_owner_user_id, p_guest_token_hash,
                                            p_revision_id, p_guest_workspace_id);
  v_actor := public.arc_ai_review_actor(p_owner_user_id, p_actor_user_id, p_revision_id);

  -- Authoritative and server-derived. The browser value is a precondition only.
  v_current := public.arc_ai_source_set_fingerprint(p_revision_id, p_guest_workspace_id);
  if p_expected_source_set_fingerprint is null
     or p_expected_source_set_fingerprint <> v_current then
    raise exception 'ARC: the selected source documents changed since they were displayed'
      using errcode = '40001';
  end if;

  select true, s.acknowledged_source_fingerprint, s.source_state, s.last_successful_run_id
    into v_exists, v_recorded, v_state, v_run
    from public.ai_analysis_state s
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id)
   for update;
  if v_exists is not true then
    raise exception 'ARC: this analysis has no AI analysis state' using errcode = '42501';
  end if;
  if v_run is null then
    raise exception 'ARC: there is no AI analysis to acknowledge' using errcode = '22023';
  end if;

  if v_recorded = v_current then
    select e.id into v_event from public.ai_review_events e
     where e.event_type = 'stale_sources_acknowledged'
       and e.source_set_fingerprint = v_current
       and coalesce(e.revision_id, e.guest_workspace_id)
           = coalesce(p_revision_id, p_guest_workspace_id)
     order by e.event_seq desc
     limit 1;
    lock_version := v_lock;
    source_set_fingerprint := v_current;
    already_acknowledged := true;
    event_id := v_event;
    return next;
    return;
  end if;

  if v_state is distinct from 'stale' then
    raise exception 'ARC: the selected source documents are not out of date'
      using errcode = '22023';
  end if;

  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed since it was loaded' using errcode = '40001';
  end if;

  update public.ai_analysis_state s
     set acknowledged_source_fingerprint = v_current,
         source_acknowledged_at = now(),
         source_acknowledged_by = v_actor,
         lock_version = s.lock_version + 1
   where (p_revision_id is not null and s.revision_id = p_revision_id)
      or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id);

  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    source_set_fingerprint)
  values (
    p_revision_id, p_guest_workspace_id, v_run,
    case when v_actor is not null then 'authenticated' else 'guest' end,
    v_actor,
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

/* ------------------- source-set mutation invalidates the acknowledgment */

-- Superseded in place. Unchanged behaviour: a source-set mutation marks a
-- previously successful analysis stale. Added: the same mutation clears the
-- current acknowledgment, including when the sidecar was already stale, so a
-- changed source set always needs a fresh acknowledgment (A -> B -> A too).
-- The historical acknowledgment event is never touched.
create or replace function public.arc_mark_ai_sources_stale(
  p_revision_id uuid,
  p_guest_workspace_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.ai_analysis_state s
     set source_state = case
           when s.last_successful_run_id is not null then 'stale'
           else s.source_state
         end,
         acknowledged_source_fingerprint = null,
         source_acknowledged_at = null,
         source_acknowledged_by = null
   where ((p_revision_id is not null and s.revision_id = p_revision_id)
       or (p_guest_workspace_id is not null and s.guest_workspace_id = p_guest_workspace_id))
     and (
       (s.last_successful_run_id is not null and s.source_state is distinct from 'stale')
       or s.acknowledged_source_fingerprint is not null
       or s.source_acknowledged_at is not null
       or s.source_acknowledged_by is not null);
end;
$$;

/* ------------------------- reconciliation-driven reopen on a new analysis */

-- Superseded in place. Every earlier guarantee is unchanged: lock order,
-- draft-only, stage checks, the source-set match and the response-loss
-- idempotent return all behave exactly as before.
--
-- Added, inside the same transaction as the apply:
--   * a `review_item_reopened` audit event for every item that was resolved in
--     the previous state and arrives open in the new Task 1-normalized state,
--     recorded with the new item's identity, fingerprint, target, section and
--     severity, and associated with the new run. The earlier affirmation or
--     manual resolution event is left untouched;
--   * the current stale-source acknowledgment is cleared, because the newly
--     successful run is now the current analysis for these sources.
-- Edit-driven reopening is not implemented here; Task 4 owns that.
create or replace function public.arc_apply_ai_run(
  p_run_id uuid,
  p_owner_user_id uuid,
  p_guest_token_hash text,
  p_expected_lock_version integer,
  p_canonical_inputs jsonb,
  p_schema_version text,
  p_ai_state jsonb,
  p_source_set_fingerprint text,
  p_structured_result jsonb,
  p_usage_metadata jsonb,
  p_review_issue_count integer
) returns table(lock_version integer, idempotent boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.ai_runs;
  v_status public.arc_revision_status;
  v_lock integer;
  v_state_id uuid;
  v_last uuid;
  v_prior jsonb;
begin
  if p_run_id is null or p_expected_lock_version is null or p_canonical_inputs is null
     or p_ai_state is null or coalesce(trim(p_schema_version), '') = '' then
    raise exception 'ARC: an apply requires a run, a lock version and canonical state'
      using errcode = '22023';
  end if;

  -- Read the run WITHOUT locking, only to discover its owner target, then take
  -- the accepted lock order: owner row -> run -> AI state.
  select * into v_run from public.ai_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'ARC: unknown AI run' using errcode = '42501';
  end if;

  if v_run.revision_id is not null then
    select r.status, r.lock_version into v_status, v_lock
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = v_run.revision_id
       and c.owner_user_id = p_owner_user_id
     for update of r;
    if v_status is null then
      raise exception 'ARC: that analysis was not found for this caller' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'ARC: only an unfinished draft can receive an AI analysis'
        using errcode = '42501';
    end if;
  else
    select g.lock_version into v_lock
      from public.guest_workspaces g
     where g.id = v_run.guest_workspace_id
       and g.token_hash = p_guest_token_hash
       and g.status = 'active'
       and g.expires_at > now()
     for update;
    if v_lock is null then
      raise exception 'ARC: that temporary workspace is no longer available' using errcode = '42501';
    end if;
  end if;

  -- Revalidate the run now that the owner row is held.
  select * into v_run from public.ai_runs where id = p_run_id for update;

  if v_run.stage = 'succeeded' then
    select s.last_successful_run_id, s.id into v_last, v_state_id
      from public.ai_analysis_state s
     where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
        or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);
    -- Response-loss retry of a committed apply: report the committed outcome
    -- without applying anything again, advancing the lock a second time, or
    -- appending a second set of reopen events.
    if v_last = p_run_id then
      lock_version := v_lock;
      idempotent := true;
      return next;
      return;
    end if;
    raise exception 'ARC: that AI run was already completed' using errcode = '42501';
  end if;

  if v_run.stage <> 'applying' then
    raise exception 'ARC: only a run in the applying stage can be applied' using errcode = '22023';
  end if;
  if v_lock <> p_expected_lock_version then
    raise exception 'ARC: the analysis changed while the AI result was being applied'
      using errcode = '40001';
  end if;
  if p_source_set_fingerprint is distinct from v_run.source_set_fingerprint then
    raise exception 'ARC: the selected source set no longer matches this run'
      using errcode = '22023';
  end if;

  if v_run.revision_id is not null then
    update public.analysis_revisions r
       set canonical_inputs = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = r.lock_version + 1
     where r.id = v_run.revision_id
       and r.status = 'draft'
       and r.lock_version = p_expected_lock_version;
    if not found then
      raise exception 'ARC: the analysis changed while the AI result was being applied'
        using errcode = '40001';
    end if;
  else
    update public.guest_workspaces g
       set draft_json = p_canonical_inputs,
           schema_version = p_schema_version,
           lock_version = g.lock_version + 1
     where g.id = v_run.guest_workspace_id
       and g.status = 'active'
       and g.lock_version = p_expected_lock_version;
    if not found then
      raise exception 'ARC: the analysis changed while the AI result was being applied'
        using errcode = '40001';
    end if;
  end if;

  -- The review state that the new analysis is about to replace.
  select s.review_items into v_prior
    from public.ai_analysis_state s
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  update public.ai_analysis_state s
     set last_successful_run_id = p_run_id,
         source_set_fingerprint = v_run.source_set_fingerprint,
         source_state = coalesce(p_ai_state ->> 'sourceState', 'current'),
         field_provenance = coalesce(p_ai_state -> 'fieldProvenance', '{}'::jsonb),
         object_provenance = coalesce(p_ai_state -> 'objectProvenance', '{}'::jsonb),
         tombstones = coalesce(p_ai_state -> 'tombstones', '[]'::jsonb),
         review_items = coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb),
         acknowledged_source_fingerprint = null,
         source_acknowledged_at = null,
         source_acknowledged_by = null,
         lock_version = s.lock_version + 1
   where (v_run.revision_id is not null and s.revision_id = v_run.revision_id)
      or (v_run.guest_workspace_id is not null and s.guest_workspace_id = v_run.guest_workspace_id);

  if not found then
    insert into public.ai_analysis_state (
      revision_id, guest_workspace_id, last_successful_run_id, source_set_fingerprint,
      source_state, field_provenance, object_provenance, tombstones, review_items)
    values (
      v_run.revision_id, v_run.guest_workspace_id, p_run_id, v_run.source_set_fingerprint,
      coalesce(p_ai_state ->> 'sourceState', 'current'),
      coalesce(p_ai_state -> 'fieldProvenance', '{}'::jsonb),
      coalesce(p_ai_state -> 'objectProvenance', '{}'::jsonb),
      coalesce(p_ai_state -> 'tombstones', '[]'::jsonb),
      coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb));
  end if;

  -- Reconciliation reopened a conclusion the accountant had already settled.
  insert into public.ai_review_events (
    revision_id, guest_workspace_id, ai_run_id, actor_kind, actor_user_id, event_type,
    review_item_id, review_target_key, review_section, review_severity, review_fingerprint)
  select v_run.revision_id, v_run.guest_workspace_id, p_run_id, 'system', null,
         'review_item_reopened',
         n.value ->> 'id', n.value ->> 'targetKey', n.value ->> 'section',
         coalesce(n.value ->> 'severity', n.value ->> 'state'),
         n.value ->> 'reviewFingerprint'
    from jsonb_array_elements(coalesce(p_ai_state -> 'reviewItems', '[]'::jsonb)) n
   where (n.value ->> 'state') in ('yellow', 'red')
     and exists (
       select 1 from jsonb_array_elements(coalesce(v_prior, '[]'::jsonb)) o
        where (o.value ->> 'id') = (n.value ->> 'id')
          and (o.value ->> 'state') = 'resolved');

  update public.ai_runs
     set stage = 'succeeded',
         completed_at = now(),
         result_metadata = p_structured_result,
         usage_metadata = p_usage_metadata,
         review_issue_count = greatest(coalesce(p_review_issue_count, 0), 0)
   where id = p_run_id;

  lock_version := p_expected_lock_version + 1;
  idempotent := false;
  return next;
end;
$$;

/* ------------------ "Save to My Contracts" re-homes the review history */

-- Superseded in place. Everything the Phase 9F routine did is unchanged. Added:
-- the temporary workspace's review events move to the newly created revision in
-- the same transaction, keeping their event id, type, item, fingerprint, run
-- context, actor identity, timestamp, reason, note and source fingerprint, so
-- the audit trail survives the later cleanup of the retired workspace.
create or replace function public.arc_migrate_guest_workspace_v3(
  p_guest_workspace_id uuid,
  p_owner_user_id uuid,
  p_existing_customer_id uuid,
  p_new_customer_name text,
  p_contract_title text,
  p_contract_number text
)
returns table (
  customer_id uuid,
  contract_id uuid,
  analysis_id uuid,
  revision_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_draft jsonb;
  v_schema_version text;
  v_customer_id uuid;
  v_contract_id uuid;
  v_analysis_id uuid;
  v_revision_id uuid;
  v_selected uuid[];
  v_new_name text := nullif(trim(coalesce(p_new_customer_name, '')), '');
  v_owns boolean;
begin
  if (p_existing_customer_id is not null)::int + (v_new_name is not null)::int <> 1 then
    raise exception 'exactly one of an existing customer or a new customer name is required'
      using errcode = '22023';
  end if;

  select g.draft_json, g.schema_version
    into v_draft, v_schema_version
  from public.guest_workspaces g
  where g.id = p_guest_workspace_id
    and g.status = 'active'
    and g.expires_at > now()
  for update;

  if v_draft is null then
    raise exception 'guest workspace % is not available for migration', p_guest_workspace_id
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'owner % does not exist', p_owner_user_id using errcode = '42501';
  end if;

  -- The owner target of an executing run must never move underneath it.
  if public.arc_ai_scope_has_active_run(null, p_guest_workspace_id) then
    raise exception 'an AI analysis is running for this analysis — try again once it finishes'
      using errcode = '55006';
  end if;

  update public.guest_workspaces
     set status = 'migrating'
   where id = p_guest_workspace_id;

  if p_existing_customer_id is not null then
    select cu.id into v_customer_id
      from public.customers cu
     where cu.id = p_existing_customer_id
       and cu.owner_user_id = p_owner_user_id
     for update;
    if v_customer_id is null then
      raise exception 'that customer is not in your workspace' using errcode = '42501';
    end if;
  else
    insert into public.customers (owner_user_id, name)
    values (p_owner_user_id, v_new_name)
    returning id into v_customer_id;
  end if;

  insert into public.contracts (customer_id, title, contract_number)
  values (v_customer_id, p_contract_title, nullif(trim(coalesce(p_contract_number, '')), ''))
  returning id into v_contract_id;

  insert into public.analyses (contract_id)
  values (v_contract_id)
  returning id into v_analysis_id;

  insert into public.analysis_revisions (analysis_id, revision_number, status, canonical_inputs, schema_version)
  values (v_analysis_id, 1, 'draft', v_draft, v_schema_version)
  returning id into v_revision_id;

  select coalesce(array_agg(s.source_document_id), '{}')
    into v_selected
    from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  update public.source_documents d
     set contract_id = v_contract_id,
         guest_workspace_id = null
   where d.guest_workspace_id = p_guest_workspace_id;

  if array_length(v_selected, 1) is not null then
    insert into public.revision_source_documents (revision_id, source_document_id)
    select v_revision_id, unnest(v_selected)
    on conflict do nothing;
  end if;

  delete from public.guest_source_document_selections s
   where s.guest_workspace_id = p_guest_workspace_id;

  -- The destination revision must really belong to the saving account. This is
  -- proven here, not left to the run trigger alone.
  select exists (
    select 1
      from public.analysis_revisions r
      join public.analyses a on a.id = r.analysis_id
      join public.contracts ct on ct.id = a.contract_id
      join public.customers c on c.id = ct.customer_id
     where r.id = v_revision_id and c.owner_user_id = p_owner_user_id)
    into v_owns;
  if not v_owns then
    raise exception 'the destination revision does not belong to this account' using errcode = '42501';
  end if;

  -- AI history re-homes as-is: same run ids, same stages, same fingerprints,
  -- same quota scope, same guest credential, same timings and metadata.
  update public.ai_runs r
     set revision_id = v_revision_id,
         guest_workspace_id = null,
         owner_user_id = p_owner_user_id
   where r.guest_workspace_id = p_guest_workspace_id;

  update public.ai_analysis_state s
     set revision_id = v_revision_id,
         guest_workspace_id = null
   where s.guest_workspace_id = p_guest_workspace_id;

  -- The one trusted ownership transition allowed on append-only history. The
  -- flag is transaction-local, set immediately before and cleared immediately
  -- after, and the trigger additionally proves that nothing but the owner
  -- scope changed.
  perform set_config('arc.review_event_rehome', 'on', true);
  update public.ai_review_events e
     set revision_id = v_revision_id,
         guest_workspace_id = null
   where e.guest_workspace_id = p_guest_workspace_id;
  perform set_config('arc.review_event_rehome', 'off', true);

  update public.guest_workspaces
     set status = 'migrated',
         migrated_user_id = p_owner_user_id
   where id = p_guest_workspace_id;

  customer_id := v_customer_id;
  contract_id := v_contract_id;
  analysis_id := v_analysis_id;
  revision_id := v_revision_id;
  return next;
end;
$$;

/* ----------------------------------------------------------- privileges */

revoke all on function public.arc_protect_ai_review_event() from public, anon, authenticated;
revoke all on function public.arc_ai_source_set_fingerprint(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_lock_ai_review_scope(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_ai_review_actor(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_bump_ai_review_scope(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_affirm_ai_review_item(uuid, text, uuid, uuid, integer, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_resolve_ai_review_issue(uuid, text, uuid, uuid, integer, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_acknowledge_ai_stale_sources(uuid, text, uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.arc_mark_ai_sources_stale(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.arc_migrate_guest_workspace_v3(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.arc_ai_source_set_fingerprint(uuid, uuid) to service_role;
grant execute on function public.arc_lock_ai_review_scope(uuid, text, uuid, uuid) to service_role;
grant execute on function public.arc_ai_review_actor(uuid, uuid, uuid) to service_role;
grant execute on function public.arc_bump_ai_review_scope(uuid, uuid) to service_role;
grant execute on function public.arc_affirm_ai_review_item(uuid, text, uuid, uuid, integer, text, text, text, uuid)
  to service_role;
grant execute on function public.arc_resolve_ai_review_issue(uuid, text, uuid, uuid, integer, text, text, text, text, uuid)
  to service_role;
grant execute on function public.arc_acknowledge_ai_stale_sources(uuid, text, uuid, uuid, integer, text, uuid)
  to service_role;
grant execute on function public.arc_mark_ai_sources_stale(uuid, uuid) to service_role;
grant execute on function public.arc_apply_ai_run(uuid, uuid, text, integer, jsonb, text, jsonb, text, jsonb, jsonb, integer)
  to service_role;
grant execute on function public.arc_migrate_guest_workspace_v3(uuid, uuid, uuid, text, text, text)
  to service_role;