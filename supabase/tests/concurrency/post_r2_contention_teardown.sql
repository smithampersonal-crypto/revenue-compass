-- ARC Post-R2 contention driver — fixture cleanup.
--
-- Removes every row the driver committed. Safe to run when nothing exists,
-- which is how the driver guarantees a clean start as well as a clean finish.

delete from public.ai_analysis_state s
 using public.guest_workspaces g
 where g.id = s.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.ai_review_events e
 using public.guest_workspaces g
 where g.id = e.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.ai_runs r
 using public.guest_workspaces g
 where g.id = r.guest_workspace_id and g.token_hash = repeat('b', 64);
delete from public.guest_workspaces where token_hash = repeat('b', 64);
