-- 1. Provenance must never block deletion of the saved chain it points at.
alter table public.guest_workspaces
  drop constraint if exists guest_workspaces_migrated_customer_id_fkey,
  drop constraint if exists guest_workspaces_migrated_contract_id_fkey,
  drop constraint if exists guest_workspaces_migrated_analysis_id_fkey,
  drop constraint if exists guest_workspaces_migrated_revision_id_fkey;

alter table public.guest_workspaces
  add constraint guest_workspaces_migrated_customer_id_fkey
    foreign key (migrated_customer_id) references public.customers(id) on delete set null,
  add constraint guest_workspaces_migrated_contract_id_fkey
    foreign key (migrated_contract_id) references public.contracts(id) on delete set null,
  add constraint guest_workspaces_migrated_analysis_id_fkey
    foreign key (migrated_analysis_id) references public.analyses(id) on delete set null,
  add constraint guest_workspaces_migrated_revision_id_fkey
    foreign key (migrated_revision_id) references public.analysis_revisions(id) on delete set null;

-- 2. Housekeeping only. Authorization is decided by expires_at on every load
--    and save, so whether this has run never widens or narrows access.
--    Physical deletion of long-expired rows is deliberately deferred to a
--    Phase 7F / operations retention job; this function only marks status.
create or replace function public.arc_expire_guest_workspaces()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_count integer;
begin
  update public.guest_workspaces
     set status = 'expired'
   where status = 'active'
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.arc_expire_guest_workspaces() from public, anon, authenticated;
grant execute on function public.arc_expire_guest_workspaces() to service_role;