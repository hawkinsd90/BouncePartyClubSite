-- BPC-DEV-MIGRATION AUTH-18 ROLLBACK for 20261027160000 (owner-approved use only; run only if a post-check fails or the owner decides to revert)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
DROP TRIGGER IF EXISTS trg_enforce_task_evidence ON public.task_status;
DROP FUNCTION IF EXISTS public.enforce_task_evidence();
DROP FUNCTION IF EXISTS public.get_task_evidence_state(uuid);
DROP FUNCTION IF EXISTS public.task_evidence_photo_count(jsonb);
DROP FUNCTION IF EXISTS public.task_evidence_required(text);
-- the overrides table (and its rows) is dropped last; export it first if any override has been written:
DROP TABLE IF EXISTS public.task_evidence_overrides;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027160000' AND statements[1] LIKE '-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18)%';
