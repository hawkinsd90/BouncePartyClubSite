/*
  # Compatibility: replace the legacy upper-case-only user_roles_role_check (fresh-database builds only)

  STATUS: LOCAL PROPOSAL (Step 4A.7). Not authorized for any hosted database. Not part of the sealed 28-file executor package.

  ## Why this file exists
  20251207163822 creates user_roles_role_check as CHECK (role IN ('MASTER','ADMIN','CREW','CUSTOMER')). Production and Development
  later lost that constraint by hand, outside the migration files. 20260324175546 then lower-cases every role, which violates the
  constraint on a database built from these files, so a fresh build stops at 20260324175546. The October migration
  20261016120000 already drops EVERY role CHECK and installs the canonical lower-case one; this file only lets the chain reach it.

  ## What it does (and only this)
  If, and only if, public.user_roles carries a CHECK named user_roles_role_check that accepts exactly the legacy upper-case vocabulary
  (all four upper-case names and no lower-case name), it is replaced by a CHECK with the SAME name that accepts the same four roles in
  upper OR lower case. Nothing else is touched.

  ## Preconditions (all must hold or the file does nothing)
  - table public.user_roles exists;
  - a CHECK constraint named user_roles_role_check exists on it;
  - its definition contains 'MASTER','ADMIN','CREW','CUSTOMER' and none of 'master','admin','crew','customer'.

  ## Postconditions
  - no upper-case-only user_roles_role_check remains;
  - a canonical lower-case CHECK (October) or any other constraint, and a missing constraint, are left exactly as they were;
  - no row is read, written or deleted; no role value outside the four existing names is accepted; no privilege is granted;
  - the replacement is temporary on a fresh build: 20261016120000 drops it and installs CHECK (role IN ('master','admin','crew','customer')).

  ## Safe to run again, and on existing databases
  Idempotent. On Development and Production (no legacy constraint, or the lower-case one) every precondition fails and the file is a
  no-op, so it can never remove the canonical constraint that 20261016120000 creates.

  ## Version
  20260324175545 is unused, runs before the 20260324175546 statement that needs it, and is OLDER than the existing ledger heads, so on
  an existing database it is pending until it is recorded (see audit/step4/strategy-a-attestation-package.md).
*/

DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_get_constraintdef(c.oid)
    INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.user_roles'::regclass
    AND c.contype = 'c'
    AND c.conname = 'user_roles_role_check';

  IF v_def IS NULL THEN
    RETURN;
  END IF;

  IF v_def ~ '''MASTER''' AND v_def ~ '''ADMIN''' AND v_def ~ '''CREW''' AND v_def ~ '''CUSTOMER'''
     AND v_def !~ '''master''' AND v_def !~ '''admin''' AND v_def !~ '''crew''' AND v_def !~ '''customer''' THEN
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_role_check
      CHECK (role IN ('MASTER', 'ADMIN', 'CREW', 'CUSTOMER', 'master', 'admin', 'crew', 'customer'));
  END IF;
END $$;
