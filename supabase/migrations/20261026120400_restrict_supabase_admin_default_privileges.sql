/*
  # Close the supabase_admin default privileges in schema public (Step 3B: SEC-015)

  Part of the coordinated Step 4 rollout (Development) and, later, the separately approved Production release. It is applied only
  through the approved Step 4 mechanism, in version order, after the October block and the four earlier Step 3B files; it is never run
  ad hoc, and the migration history records it only when the security outcome below is true. The read-only pre/post checks are in
  audit/security/step3b-verification-rules.json.

  ## Problem
  Production carries schema-level default privileges for the role `supabase_admin` in `public` (6 default ACL rows, verified read-only
  2026-10-17) that hand every NEW table, function and sequence created by `supabase_admin` (dashboard / SQL editor / platform tooling)
  to `anon` and `authenticated`. 20261018120000 closes only the defaults of the migration owner `postgres`. Development has no
  `public` defaults and must not receive Production's.

  ## Fix (fail closed)
  1. Postcondition: no default ACL for schema `public` owned by `supabase_admin` or `postgres` names `anon`, `authenticated` or PUBLIC.
  2. If it already holds (Development, a fresh database, or defaults closed beforehand) the file does nothing and passes.
  3. Otherwise it removes the `anon` / `authenticated` entries from the `supabase_admin` defaults for tables, sequences and functions.
  4. It then checks the postcondition again and RAISES (SQLSTATE 42501) if it does not hold, so the transaction rolls back and NO
     migration-history row is written. A privilege failure can therefore never be recorded as success.

  ## Step 4 gate (hosted capability is NOT verified)
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` needs superuser or membership in `supabase_admin`. Locally the migration operator
  is a superuser, so it succeeds on both replays; a non-superuser operator that is not a member is refused (reproduced locally). The
  hosted `postgres` role is not superuser and its membership is unverified. Before the Production run, and before the Development run if
  the read-only check below shows defaults, the owner must either confirm the hosted operator can do it or close the defaults once from
  the dashboard SQL editor as `supabase_admin` (same three statements as step 3, no new role). Check, read-only:
      SELECT pg_get_userbyid(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl
      WHERE defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(defaclrole) IN ('supabase_admin', 'postgres');
  Existing objects are not changed. Reversible by the opposite GRANT statements.
*/

DO $$
DECLARE
  leaked integer;
  attempt_error text;

  -- number of default ACL entries in schema public (owned by supabase_admin or postgres) that name anon, authenticated or PUBLIC
  entries_open CONSTANT text :=
    $q$SELECT count(*)
       FROM pg_default_acl d
       CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE d.defaclnamespace = 'public'::regnamespace
         AND pg_get_userbyid(d.defaclrole) IN ('supabase_admin', 'postgres')
         AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))$q$;
BEGIN
  EXECUTE entries_open INTO leaked;
  IF leaked = 0 THEN
    RAISE NOTICE 'default privileges in schema public already close anon and authenticated: nothing to do';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    EXCEPTION WHEN insufficient_privilege THEN
      attempt_error := SQLERRM;
    END;
  END IF;

  EXECUTE entries_open INTO leaked;
  IF leaked > 0 THEN
    RAISE EXCEPTION 'default privileges in schema public still name anon, authenticated or PUBLIC (% entries)%. Close them as supabase_admin (see the header of this migration), then run this migration again.',
      leaked, CASE WHEN attempt_error IS NULL THEN '' ELSE ' because this role may not change them: ' || attempt_error END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
