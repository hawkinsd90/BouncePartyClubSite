/*
  # Restrict sequence privileges and anonymous table privileges (Step 3B: SEC-014, SEC-039, SEC-037)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded. Privilege changes only: no data, policy, table or
  function body is changed. Safe on Production and Development, and safe to run twice. It stops (SQLSTATE 42501) if an anonymous privilege would
  remain through a PUBLIC grant, rather than recording a partial result.

  ## 1. Sequences (SEC-014)
  Production grants `anon` USAGE and UPDATE (`setval`) on `receipt_number_seq` and `payments_ledger_sequence_seq` (verified read-only
  2026-10-17). The grants come from the hosted default privileges handing every new object to the API roles, and no earlier migration
  revokes them on EXISTING sequences (20261018120000 only changes the defaults for future objects). PostgREST does not expose sequences
  directly, so this is defence in depth, but a caller that reaches the database with the `anon` or `authenticated` role could renumber
  receipts or burn the ledger sequence.
    - anon: every privilege on every public sequence is removed. No anonymous flow uses a sequence: receipt numbers come from the
      SECURITY DEFINER function generate_receipt_number, and payments.ledger_sequence is filled by server-side payment functions.
    - authenticated: UPDATE (setval) is removed. USAGE/SELECT are kept so a signed-in staff session keeps working if any
      SECURITY INVOKER path ever evaluates a column default; the sequences cannot be reset or moved.
    - service_role is untouched.

  ## 2. Anonymous table privileges (SEC-039, defence in depth)
  Row level security is the real gate and no anonymous policy exists on the tables below, so anonymous access is already denied. The
  table-level privileges still exist (`anon` holds SELECT on admin_settings, which stores provider credentials, and on logs and
  conversations), which leaves a single missing policy between the public key and the data. Anonymous privileges are removed from
  every public table that has NO policy naming `anon` or `public`. Tables that DO have such a policy (the public catalog reads and the
  signup-consent insert) keep their grants, except for write privileges the policy does not use:
    - pending_signups_consent keeps INSERT only (its one anonymous policy is an INSERT policy).
  Nothing an anonymous visitor can do today changes: they can only reach rows a policy lets them see, and every such table is kept.
  Future tables are covered by the default privileges set in 20261018120000.

  ## 3. Unpinned SECURITY DEFINER search_path (SEC-037)
  `update_google_reviews_updated_at()` is the only SECURITY DEFINER function without a pinned search_path (verified on the replayed
  chain; Step 2 counted exactly one on both databases). It is a trigger function that only sets `updated_at`; pinning the path changes
  nothing it does.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Sequences
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Anonymous table privileges follow the policies
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.name);
  END LOOP;
END $$;

-- The one table whose only anonymous policy is an INSERT policy: remove the privileges that policy does not use.
DO $$
BEGIN
  IF to_regclass('public.pending_signups_consent') IS NOT NULL THEN
    REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pending_signups_consent FROM anon;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Pin the search_path of the one unpinned SECURITY DEFINER function
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.update_google_reviews_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.update_google_reviews_updated_at() SET search_path = public, pg_temp;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Postcondition (fail closed): no anonymous privilege may remain, whatever its source (a direct grant, a grant to PUBLIC, a role
--    membership). has_*_privilege() evaluates the EFFECTIVE privilege, so a grant to PUBLIC that the REVOKEs above cannot remove is
--    caught here and the transaction rolls back instead of recording a partial result.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO remaining
  FROM (
    -- (OFFSET 0 keeps the planner from asking has_sequence_privilege about relations that are not sequences)
    SELECT 'sequence ' || c.relname AS name
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('anon', c.oid, 'USAGE') OR has_sequence_privilege('anon', c.oid, 'SELECT') OR has_sequence_privilege('anon', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'sequence ' || c.relname
    FROM (SELECT oid, relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S' OFFSET 0) c
    WHERE has_sequence_privilege('authenticated', c.oid, 'UPDATE')
    UNION ALL
    SELECT 'table ' || c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname AND (p.roles && ARRAY['anon', 'public']::name[])
      )
  ) x;

  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous privileges remain after the revokes (a grant to PUBLIC or an inherited role?): %', remaining
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
