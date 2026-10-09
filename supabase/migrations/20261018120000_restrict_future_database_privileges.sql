/*
  # Restrict the privileges that FUTURE database objects start with

  ## Problem
  Every table, function and sequence the migrations create is owned by the role `postgres` (the migration role). What such an
  object can be used for by other roles at the moment it is created is decided by that role's DEFAULT PRIVILEGES:

  - PostgreSQL's built-in default lets PUBLIC (so anon and authenticated) EXECUTE every new function. A function added by a
    later migration, including a SECURITY DEFINER one, would be callable by the public API unless that migration remembered
    to revoke it. Several earlier migrations had to clean this up after the fact.
  - A hosted project may also carry schema-level default privileges for `public` that hand every new table, sequence and
    function to anon and authenticated. Whether a given project (Dev, Production) has them differs, so this migration does not
    assume either shape.

  ## Rule after this migration
  Future objects created by `postgres` begin CLOSED:
  - functions: not executable by PUBLIC, anon or authenticated; executable by service_role (the backend)
  - tables:    no privileges for anon or authenticated; full access for service_role
  - sequences: no privileges for anon or authenticated; full access for service_role
  An object meant for the public API or for signed-in users is opened on purpose with an explicit GRANT in the migration that
  creates it (`GRANT EXECUTE ON FUNCTION ... TO anon, authenticated`, `GRANT SELECT ON ... TO anon`, and so on). Explicit
  grants keep working exactly as before.

  ## Scope
  - The anon / authenticated / service_role defaults are set for the owner role `postgres` and ONLY in the `public` schema.
  - PostgreSQL's built-in "PUBLIC may execute every new function" default cannot be removed for one schema; it can only be removed
    for the owner role everywhere. So the one owner-wide statement is the function revoke from PUBLIC for `postgres`. What it
    reaches was checked read-only against Dev (function count, owner and PUBLIC execute per schema):
      public        82 functions, all owned by postgres   - this application's code; it must start closed (the point of this migration)
      extensions    49 owned by postgres (pgcrypto, uuid-ossp, pg_stat_statements; 48 callable by PUBLIC), 6 by supabase_admin
                    - extension installs; the repository's own migrations call them (gen_random_bytes, gen_salt, uuid_generate_v4)
                    and they are callable by PUBLIC today, so PUBLIC execute is granted back by default in this schema only
      auth, graphql_public, pgbouncer, realtime, storage, vault - owned by supabase_auth_admin, supabase_admin,
                    supabase_realtime_admin and supabase_storage_admin, never by postgres, so a default set FOR ROLE postgres
                    cannot reach them
    No repository migration creates a function outside `public` (nothing is schema-qualified to another schema), so no workflow
    depends on a future postgres-owned function elsewhere receiving PUBLIC execute. A future postgres-owned function in any other
    schema simply starts closed, like this application's own.
  - An extension installed WITHOUT `WITH SCHEMA extensions` would put its functions in `public`, closed by default; install
    extensions into `extensions` (the project convention).
  - NO existing table, function or sequence has its privileges changed by this migration.
  - Objects owned by Supabase's own roles (auth, storage, realtime, ...) are not touched.
*/

-- Functions: remove PUBLIC's built-in execute for the owner role everywhere, then re-open it where Supabase's own extension
-- installs depend on it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
  END IF;
END $$;

-- The application schema: nothing for the public API by default, everything for the backend.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
