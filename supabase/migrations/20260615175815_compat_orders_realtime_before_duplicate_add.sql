/*
  # Compatibility: let 20260615175816 add orders to the realtime publication on a fresh build

  STATUS: LOCAL PROPOSAL (Step 4A.7, corrected in the Step 4A.7 review). Not authorized for any hosted database. Not part of the sealed
  28-file executor package.

  ## Why this file exists
  20260324051459 already adds public.orders to supabase_realtime (guarded). 20260615175816 adds it again with an unguarded
  ALTER PUBLICATION ... ADD TABLE, which PostgreSQL rejects ("relation orders is already member of publication"), so a database built
  from the files stops there. PostgreSQL has no IF NOT EXISTS for ADD TABLE.

  ## What it does (and only this)
  When, and only when, THREE INDEPENDENT tests all show that the files are being applied in order on a database that is still before
  20260615175816, it removes public.orders from supabase_realtime so that 20260615175816 can add it again. Replica identity,
  row-level security and every other publication member are untouched.

  ## Why one test is not enough (the review that changed this file)
  The first version trusted the migration ledger alone. A schema that is ahead of its ledger (a wrong or partly restored ledger, or
  a ledger exported without its later versions) made it remove orders from the publication on a database that is at its head, and
  nothing would put it back. The ledger is therefore only ONE of three tests and any single test that says "existing database" makes
  the file do nothing:
    1. LEDGER: the ledger is absent, or contains no version >= 20260615175816.
    2. LATER OBJECTS: none of these tables exists, each created by a different migration AFTER 20260615175816:
       public.inventory_products (20260716151458), public.order_portal_links (20260722212750), public.package_inflatable_eligibility (20260718000744),
       public.public_menu_groups (20260929145842). Any one of them present means the database is past this point, whatever the ledger says.
    3. DATA: public.orders exists, does not use FORCE ROW LEVEL SECURITY (so emptiness can be proven) and contains no row. A database
       holding orders is never touched.
  Any unexpected error while testing also means "do nothing" (the file records the reason in a NOTICE and returns).

  ## Preconditions (all must hold for the file to act)
  - publication supabase_realtime exists and public.orders is a member;
  - tests 1, 2 and 3 above all pass.

  ## Postconditions
  - when it acts: public.orders is not in supabase_realtime until 20260615175816 adds it; relreplident of orders is unchanged;
  - otherwise: nothing changed.

  ## Safe to run again, and on existing databases
  Idempotent (a second run finds orders absent). On Development (head 20260929161925, 171 orders, all four later tables present) and
  Production (head 20260928172217) every test says "existing database" and the file does nothing, so it cannot switch realtime off.
  Residual case, documented not hidden: a database that is truly at 20260615175816 or just after it, has NO orders, has none of the later
  tables and has no ledger would be treated as a fresh build; no customer data can be involved in that state.

  ## Version
  20260615175815 is unused, runs immediately before 20260615175816, and is OLDER than the existing ledger heads, so on an existing
  database it is pending until it is recorded (see audit/step4/strategy-a-attestation-package.md).
*/

DO $$
DECLARE
  v_reason text := NULL;
  v_later  boolean := false;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      v_reason := 'publication supabase_realtime does not exist';
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
      v_reason := 'public.orders is not a member of the publication';
    END IF;

    -- test 1: ledger
    IF v_reason IS NULL AND to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version >= ''20260615175816'')' INTO v_later;
      IF v_later THEN
        v_reason := 'the ledger already holds 20260615175816 or a later version';
      END IF;
    END IF;

    -- test 2: objects created by migrations after 20260615175816
    IF v_reason IS NULL AND (
         to_regclass('public.inventory_products') IS NOT NULL
      OR to_regclass('public.order_portal_links') IS NOT NULL
      OR to_regclass('public.package_inflatable_eligibility') IS NOT NULL
      OR to_regclass('public.public_menu_groups') IS NOT NULL
    ) THEN
      v_reason := 'objects created by later migrations exist';
    END IF;

    -- test 3: data
    IF v_reason IS NULL THEN
      IF to_regclass('public.orders') IS NULL THEN
        v_reason := 'public.orders does not exist';
      ELSIF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass) THEN
        v_reason := 'public.orders uses FORCE ROW LEVEL SECURITY, so emptiness cannot be proven';
      ELSIF EXISTS (SELECT 1 FROM public.orders) THEN
        v_reason := 'public.orders contains rows';
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_reason := 'unexpected error, nothing changed: ' || SQLERRM;
  END;

  IF v_reason IS NOT NULL THEN
    RAISE NOTICE 'compat 20260615175815 did nothing: %', v_reason;
  END IF;
END $$;
