-- ARC Phase 8G — privilege narrowing. Additive and non-behavioural: browser
-- roles never needed TRUNCATE (which bypasses row-level security entirely),
-- REFERENCES or TRIGGER on ARC tables.
revoke truncate, references, trigger on public.customers from anon, authenticated;
revoke truncate, references, trigger on public.contracts from anon, authenticated;
revoke truncate, references, trigger on public.analyses from anon, authenticated;
revoke truncate, references, trigger on public.analysis_revisions from anon, authenticated;
revoke truncate, references, trigger on public.source_documents from anon, authenticated;
revoke truncate, references, trigger on public.revision_source_documents from anon, authenticated;
revoke truncate, references, trigger on public.guest_workspaces from anon, authenticated;
revoke truncate, references, trigger on public.guest_source_document_selections from anon, authenticated;
revoke truncate, references, trigger on public.document_upload_intents from anon, authenticated;
revoke truncate, references, trigger on public.storage_deletion_queue from anon, authenticated;