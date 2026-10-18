/*
  # Crew task creation and receipt-flag updates after the core lockdown (Step 3B: SEC-036)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded. Adds two narrow policies; changes no existing policy.

  ## Problems (both are regressions the 20261012120000 lockdown leaves behind; found by the Step 2 caller scan)
  1. `taskStatusService.ensureTaskStatus` inserts a missing `task_status` row. Only an Admin/Master policy allows INSERT, so a Crew
     session that opens a task whose row was not pre-created gets a permission error.
  2. `transactionReceiptService` sets `receipt_sent_to_admin` with an UPDATE. No policy allows UPDATE on `transaction_receipts`, so
     the update silently matches no rows and the flag never changes.

  ## Fix
  - `task_status`: Crew, Admin and Master may INSERT (uses the existing `is_crew_or_admin()` helper, like the Crew SELECT/UPDATE policies).
  - `transaction_receipts`: Admin and Master may UPDATE (uses the existing `is_admin()` helper, like the existing INSERT/SELECT policies).
    Crew and customers get nothing. Receipts are only created by admin flows, so Admin is the only legitimate editor.
  Anonymous callers and ordinary customers are not granted anything. Policies are created only when missing, so a second run is a no-op.
*/

DO $$
BEGIN
  IF to_regclass('public.task_status') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'task_status' AND policyname = 'Crew create task status') THEN
    CREATE POLICY "Crew create task status" ON public.task_status
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.is_crew_or_admin()));
  END IF;

  IF to_regclass('public.transaction_receipts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transaction_receipts' AND policyname = 'Admin and master update transaction receipts') THEN
    CREATE POLICY "Admin and master update transaction receipts" ON public.transaction_receipts
      FOR UPDATE TO authenticated
      USING ((SELECT public.is_admin()))
      WITH CHECK ((SELECT public.is_admin()));
  END IF;
END $$;
