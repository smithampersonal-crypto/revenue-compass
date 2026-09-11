alter table public.guest_workspaces
  drop constraint if exists guest_workspaces_migrated_user_id_fkey;

alter table public.guest_workspaces
  add constraint guest_workspaces_migrated_user_id_fkey
  foreign key (migrated_user_id) references auth.users(id) on delete cascade;