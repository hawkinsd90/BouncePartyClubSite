-- BPC-DEV-MIGRATION AUTH-18 ROLLBACK for 20261027130000 (owner-approved use only; run only if a post-check fails or the owner decides to revert)
SET LOCAL lock_timeout = '3s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
DROP FUNCTION IF EXISTS public.claim_post_payment_completion(uuid, integer);
DROP FUNCTION IF EXISTS public.finish_post_payment_completion(uuid);
DROP FUNCTION IF EXISTS public.release_post_payment_claim(uuid);
DROP INDEX IF EXISTS public.uq_transaction_receipts_pi_type;
DROP INDEX IF EXISTS public.uq_transaction_receipts_charge_type;
DROP INDEX IF EXISTS public.uq_transaction_receipts_payment_type;
-- the two original NULLS NOT DISTINCT constraints are restored only while no receipt without a Stripe id has been written since the migration:
ALTER TABLE public.transaction_receipts ADD CONSTRAINT unique_receipt_pi_type UNIQUE NULLS NOT DISTINCT (stripe_payment_intent_id, transaction_type);
ALTER TABLE public.transaction_receipts ADD CONSTRAINT unique_receipt_charge_type UNIQUE NULLS NOT DISTINCT (stripe_charge_id, transaction_type);
ALTER TABLE public.invoices DROP COLUMN IF EXISTS setup_fee_cents;
ALTER TABLE public.payments DROP COLUMN IF EXISTS post_claim_until;
ALTER TABLE public.payments DROP COLUMN IF EXISTS post_completed_at;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027130000' AND statements[1] LIKE '-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18)%';
