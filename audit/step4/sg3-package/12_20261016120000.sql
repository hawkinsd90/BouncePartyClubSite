-- BPC-DEV-EXECUTOR step 12/28; version 20261016120000; file 20261016120000_repair_role_assignment_and_signup_provisioning.sql; sha256_lf 2ca02e10dfa040575798c71ef30bf605f6a7ad8b54918928e99a41f7deb6970b; package 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '120000ms';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-executor'));
DO $bpcpre$
DECLARE fp jsonb; fp_all text; old_sp text; v_n bigint; v_h text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: wrong database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected role'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'BPC-EXECUTOR: no migration ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261016120000') THEN RAISE EXCEPTION 'BPC-EXECUTOR: version already recorded: 20261016120000'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261015123000']::text[])) <> 1 THEN RAISE EXCEPTION 'BPC-EXECUTOR: predecessor not recorded for 20261016120000'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]) AND version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000']::text[]);
  IF v_n <> 0 THEN RAISE EXCEPTION 'BPC-EXECUTOR: a package version later than this step is already recorded'; END IF;
  SELECT count(*) INTO v_n FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000']::text[]) AND statements[1] LIKE '-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1;%';
  IF v_n <> 11 THEN RAISE EXCEPTION 'BPC-EXECUTOR: the earlier package steps are not all recorded by this executor'; END IF;
  SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(version, E'\n' ORDER BY version), ''), 'UTF8')), 'hex') INTO v_n, v_h FROM supabase_migrations.schema_migrations WHERE version <> ALL(ARRAY['20261007120000','20261008120000','20261009120000','20261010110000','20261010120000','20261011120000','20261012120000','20261013120000','20261014120000','20261015120000','20261015123000','20261016120000','20261017120000','20261018120000','20261018120100','20261018120200','20261019120000','20261020120000','20261021120000','20261022120000','20261023120000','20261024120000','20261025120000','20261026120000','20261026120100','20261026120200','20261026120300','20261026120400']::text[]);
  IF v_n <> 305 OR v_h <> '76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59' THEN RAISE EXCEPTION 'BPC-EXECUTOR: ledger outside the package differs from the approved export (% rows, hash %)', v_n, v_h; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: schema containment is not in force'; END IF;

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '7953318d739fc05ad28218c3030477f3' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261016120000 (expected 7953318d739fc05ad28218c3030477f3, observed %), categories: %', 'pre', fp_all, fp USING ERRCODE = 'P0001'; END IF;
END $bpcpre$;
-- exact file 20261016120000_repair_role_assignment_and_signup_provisioning.sql
/*
  # Repair role assignment and signup provisioning

  ## Problems
  1. assign_role_by_email (Admin > Permissions > Add user by email) used ON CONFLICT (user_id). public.user_roles is unique on
     (user_id, role) only, so PostgreSQL rejects the statement ("there is no unique or exclusion constraint matching the
     ON CONFLICT specification") and the function failed for every existing user.
  2. auto_assign_customer_role (the signup trigger function) used the same invalid arbiter for its role step. Its exception
     handler swallowed the error, so a new signup completed WITHOUT a role, a customer, a contact or a profile.
  3. assign_role_by_email compared the requested role case-sensitively (p_role = 'master'). Repairing only the arbiter would have
     let an Admin grant the master role by sending 'MASTER' (every other authorization helper compares lower(role)).
  4. The repository defined a CHECK on user_roles.role that accepts only UPPERCASE values, while the application, the RLS
     policies, user_permissions_changelog and the Edge Functions all use lowercase (master, admin, crew, customer). A fresh
     replay rejected the application's own writes. Dev has neither that CHECK nor the original foreign key to auth.users.
  5. The auth.users trigger that runs the signup function is absent on Dev.
  6. The signup function writes customer_profiles.first_name / last_name. Migration 20251229223230
     (update_customer_profiles_names) already adds them (the table was built with display_name), so they exist on Production,
     on Dev and in a replay; the ADD COLUMN IF NOT EXISTS below only keeps this migration self-contained.

  ## What this migration does
  - Canonical role vocabulary, stored in ONE form: master, admin, crew, customer (lowercase).
  - Normalizes any existing role value by trimming and lowercasing it (dropping a row only when normalizing would duplicate
    another row of the same user), and REFUSES to continue if any value is still outside the vocabulary, so nothing is guessed.
  - Replaces the role CHECK with the lowercase vocabulary.
  - Removes role rows whose auth user no longer exists (they can never match a signed-in user) and restores the foreign key
    user_roles.user_id -> auth.users(id) ON DELETE CASCADE. It refuses to delete anything if auth.users is empty.
  - assign_role_by_email: normalizes the requested role first (trim, lowercase, allowlist master / admin / crew), authorizes with
    the NORMALIZED role, derives the caller's strongest role from all of their rows (master outranks admin), keeps an Admin from
    changing an existing admin or master, and replaces the target's role atomically with exactly the requested one. An unknown
    email still returns false.
  - auto_assign_customer_role: only the role step changes. It gives the customer role to a user who has no role, and never
    replaces or adds to an existing one. Everything else the function does is unchanged, including its error handling.
  - Adds customer_profiles.first_name and last_name when they are missing (a no-op on Dev, where they already exist). The
    older display_name column is left alone.
  - Recreates the single intended trigger on_auth_user_created (AFTER INSERT ON auth.users -> auto_assign_customer_role()).

  ## What it does NOT do
  No UNIQUE (user_id) is added (UNIQUE (user_id, role) is kept). get_user_role, the older multi-role helpers, default
  privileges, and every other function grant are untouched.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Existing data: one canonical lowercase form, no stale rows
-- ---------------------------------------------------------------------------------------------------------------------
-- Drop every CHECK that constrains the role column (whatever it was called) BEFORE normalizing: a legacy CHECK that accepts only
-- UPPERCASE roles would reject the lowercase values written below. The lowercase CHECK is added after the vocabulary guard.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~* '\mrole\M'
  LOOP
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  -- Rows that would become duplicates of another row of the same user once normalized: keep the earliest.
  DELETE FROM public.user_roles a
  USING public.user_roles b
  WHERE a.user_id = b.user_id
    AND a.id <> b.id
    AND lower(btrim(a.role)) = lower(btrim(b.role))
    AND (coalesce(a.created_at, '-infinity'::timestamptz), a.id) > (coalesce(b.created_at, '-infinity'::timestamptz), b.id);

  UPDATE public.user_roles SET role = lower(btrim(role)) WHERE role <> lower(btrim(role));

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role NOT IN ('master', 'admin', 'crew', 'customer')) THEN
    RAISE EXCEPTION 'user_roles contains a role outside master / admin / crew / customer; review those rows before applying this migration';
  END IF;
END $$;

-- Canonical CHECK, added only after every row has been normalized and validated above.
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check CHECK (role IN ('master', 'admin', 'crew', 'customer'));

-- Role rows for an auth user that no longer exists can never match a signed-in user. Remove them, then restore the original
-- foreign key (skipped when a foreign key from user_roles.user_id to auth.users already exists, under any name).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users) THEN
      RAISE EXCEPTION 'auth.users is empty; refusing to treat every user_roles row as an orphan';
    END IF;

    DELETE FROM public.user_roles ur
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id);

    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. assign_role_by_email
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_role_by_email(p_email text, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_role        text;
  v_target_id   uuid;
  v_keep        uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Only admin or master users can assign roles';
  END IF;

  -- The caller's strongest role, read from ALL of their rows (never an arbitrary one): master outranks admin.
  SELECT CASE
           WHEN bool_or(lower(btrim(role)) = 'master') THEN 'master'
           WHEN bool_or(lower(btrim(role)) = 'admin') THEN 'admin'
         END
  INTO v_caller_role
  FROM public.user_roles
  WHERE user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Only admin or master users can assign roles';
  END IF;

  -- Normalize FIRST. Every check below uses this value, so 'MASTER', 'Master', ' master ' and 'master' are one request.
  v_role := lower(btrim(p_role, E' \t\r\n'));
  IF v_role IS NULL OR v_role NOT IN ('master', 'admin', 'crew') THEN
    RAISE EXCEPTION 'Invalid role: only master, admin or crew can be assigned';
  END IF;

  IF v_role = 'master' AND v_caller_role <> 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the master role';
  END IF;

  IF v_role = 'admin' AND v_caller_role <> 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the admin role';
  END IF;

  SELECT id INTO v_target_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_email, E' \t\r\n'))
  ORDER BY created_at, id
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN false;
  END IF;

  -- One assignment at a time per target user.
  PERFORM pg_advisory_xact_lock(hashtextextended('user_roles:' || v_target_id::text, 0));

  -- An Admin cannot change a user who is an admin or a master (the Permissions screen applies the same rule).
  IF v_caller_role <> 'master' AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_target_id AND lower(btrim(role)) IN ('master', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only master users can change an admin or master';
  END IF;

  -- Replace the target's role with exactly the requested one. user_roles is unique on (user_id, role), so this is done with
  -- the row that already holds the requested role (else the oldest row), removing any other rows the user unexpectedly has.
  SELECT id INTO v_keep
  FROM public.user_roles
  WHERE user_id = v_target_id
  ORDER BY (lower(btrim(role)) = v_role) DESC, created_at, id
  LIMIT 1;

  IF v_keep IS NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_target_id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = v_target_id AND id <> v_keep;
    UPDATE public.user_roles SET role = v_role WHERE id = v_keep AND role <> v_role;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_role_by_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_role_by_email(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. auto_assign_customer_role (signup provisioning): only the role step changes
-- ---------------------------------------------------------------------------------------------------------------------

-- The signup function stores the customer's name in customer_profiles.first_name / last_name. Migration 20251229223230
-- (update_customer_profiles_names) already adds them, so this is a no-op wherever that migration was applied.
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

CREATE OR REPLACE FUNCTION public.auto_assign_customer_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_customer_id uuid;
  existing_contact_id  uuid;
  new_address_id       uuid;
  user_email           text;
  user_full_name       text;
  user_first_name      text;
  user_last_name       text;
  user_phone           text;
  v_oauth_provider     text;
  profile_data         jsonb;
  v_step               text := 'init';
  v_error_message      text;
BEGIN
  user_email := NEW.email;

  -- Explicit first_name/last_name from signup form take priority over Google full_name
  user_first_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), '');
  user_last_name  := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), '');

  -- Only fall back to parsing name/full_name if explicit fields were not provided
  IF user_first_name IS NULL THEN
    user_full_name  := COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    );
    user_first_name := split_part(user_full_name, ' ', 1);
    user_last_name  := CASE WHEN position(' ' IN user_full_name) > 0
      THEN split_part(user_full_name, ' ', 2)
      ELSE COALESCE(user_last_name, '')
    END;
  END IF;

  user_phone       := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  v_oauth_provider := NEW.raw_app_meta_data->>'provider';

  profile_data := jsonb_build_object(
    'name',       COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'picture',    COALESCE(NEW.raw_user_meta_data->>'picture', ''),
    'email',      user_email,
    'locale',     COALESCE(NEW.raw_user_meta_data->>'locale', ''),
    'provider',   v_oauth_provider
  );

  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
  VALUES (
    NEW.id, user_email, 'trigger_start', 'started',
    'Auto-assign customer role trigger started',
    jsonb_build_object(
      'first_name', user_first_name, 'last_name', user_last_name,
      'phone', user_phone, 'provider', v_oauth_provider
    )
  );

  -- Give the new user the customer role - but only a user who has no role yet. user_roles is unique on (user_id, role), not on
  -- user_id alone, so the old ON CONFLICT (user_id) could never be planned and failed every signup at this step. A user who
  -- already holds ANY role (master, admin, crew, or customer) keeps it: this trigger never replaces or adds to an existing role.
  v_step := 'insert_user_role';
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, 'customer'
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.id)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Look up existing customer by email
  v_step := 'lookup_customer';
  SELECT id INTO existing_customer_id
  FROM public.customers
  WHERE email = user_email
  LIMIT 1;

  IF existing_customer_id IS NOT NULL THEN
    -- Link user_id and update OAuth data, but also update name if signup form provided explicit values
    v_step := 'update_existing_customer';
    UPDATE public.customers
    SET
      user_id            = NEW.id,
      oauth_provider     = v_oauth_provider,
      oauth_profile_data = profile_data,
      -- Update first/last name only when the incoming value is non-empty
      -- (signup form data wins over whatever was previously stored)
      first_name         = CASE WHEN COALESCE(NULLIF(TRIM(user_first_name), ''), '') != ''
                             THEN user_first_name
                             ELSE first_name END,
      last_name          = CASE WHEN COALESCE(NULLIF(TRIM(user_last_name), ''), '') != ''
                             THEN user_last_name
                             ELSE last_name END,
      phone              = COALESCE(NULLIF(customers.phone, ''), user_phone)
    WHERE id = existing_customer_id;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
    VALUES (NEW.id, user_email, v_step, 'success', 'Linked user_id to existing customer');

    v_step := 'create_contact_for_customer';
    INSERT INTO public.contacts (customer_id, first_name, last_name, email, phone, source, total_bookings)
    VALUES (
      existing_customer_id, user_first_name, user_last_name,
      user_email, user_phone, 'signup',
      (SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id)
    )
    ON CONFLICT (email) DO UPDATE SET
      first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                     THEN EXCLUDED.first_name ELSE contacts.first_name END,
      last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                     THEN EXCLUDED.last_name ELSE contacts.last_name END,
      last_contact_date = now()
    RETURNING id INTO existing_contact_id;

    IF existing_contact_id IS NULL THEN
      SELECT id INTO existing_contact_id FROM public.contacts WHERE email = user_email LIMIT 1;
    END IF;

  ELSE
    -- Create customer + contact from scratch
    IF existing_contact_id IS NULL AND existing_customer_id IS NULL THEN
      v_step := 'create_new_customer';
      INSERT INTO public.customers (user_id, first_name, last_name, email, phone, oauth_provider, oauth_profile_data)
      VALUES (
        NEW.id, user_first_name, user_last_name,
        user_email, user_phone, v_oauth_provider, profile_data
      )
      ON CONFLICT (email) DO UPDATE
      SET
        user_id            = NEW.id,
        oauth_provider     = EXCLUDED.oauth_provider,
        oauth_profile_data = EXCLUDED.oauth_profile_data,
        first_name         = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                               THEN EXCLUDED.first_name ELSE customers.first_name END,
        last_name          = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                               THEN EXCLUDED.last_name ELSE customers.last_name END
      RETURNING id INTO existing_customer_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, v_step, 'success', 'Created new customer record');

      -- Google address extraction
      IF v_oauth_provider = 'google' AND profile_data ? 'address' THEN
        v_step := 'create_google_address';
        BEGIN
          INSERT INTO public.addresses (user_id, line1, city, state, zip, is_default)
          SELECT NEW.id,
                 profile_data->'address'->>'street_address',
                 profile_data->'address'->>'locality',
                 profile_data->'address'->>'region',
                 profile_data->'address'->>'postal_code',
                 true
          WHERE profile_data->'address'->>'street_address' IS NOT NULL
            AND profile_data->'address'->>'locality' IS NOT NULL
          ON CONFLICT DO NOTHING;

          IF FOUND THEN
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
            VALUES (NEW.id, user_email, v_step, 'success', 'Created address from Google profile');
          ELSE
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
            VALUES (NEW.id, user_email, v_step, 'skipped', 'Insufficient address data from Google');
          END IF;
        EXCEPTION WHEN OTHERS THEN
          INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
          VALUES (NEW.id, user_email, v_step, 'skipped', 'Could not extract address from Google profile');
        END;
      END IF;

      v_step := 'create_new_contact';
      INSERT INTO public.contacts (customer_id, first_name, last_name, email, phone, source, total_bookings)
      VALUES (existing_customer_id, user_first_name, user_last_name, user_email, user_phone, 'signup', 0)
      ON CONFLICT (email) DO UPDATE SET
        first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                       THEN EXCLUDED.first_name ELSE contacts.first_name END,
        last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                       THEN EXCLUDED.last_name ELSE contacts.last_name END,
        last_contact_date = now()
      RETURNING id INTO existing_contact_id;

      IF existing_contact_id IS NULL THEN
        SELECT id INTO existing_contact_id FROM public.contacts WHERE email = user_email LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- Create customer_profile (first_name/last_name from signup form take priority)
  v_step := 'create_customer_profile';
  INSERT INTO public.customer_profiles (user_id, contact_id, first_name, last_name, phone)
  VALUES (NEW.id, existing_contact_id, user_first_name, user_last_name, user_phone)
  ON CONFLICT (user_id) DO UPDATE
  SET contact_id = EXCLUDED.contact_id,
      first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                     THEN EXCLUDED.first_name ELSE customer_profiles.first_name END,
      last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                     THEN EXCLUDED.last_name ELSE customer_profiles.last_name END,
      phone      = EXCLUDED.phone,
      updated_at = now();

  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
  VALUES (NEW.id, user_email, 'trigger_complete', 'success', 'Trigger completed successfully');

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
  VALUES (NEW.id, NEW.email, v_step, 'error', v_error_message)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_assign_customer_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_customer_role() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The one signup trigger
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  -- A second trigger running the same function under another name would provision every signup twice.
  FOR t IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
      AND tgfoid = 'public.auto_assign_customer_role()'::regprocedure
      AND tgname <> 'on_auth_user_created'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users', t.tgname);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_customer_role();
;
DO $bpcpost$
DECLARE fp jsonb; fp_all text; old_sp text;
BEGIN

  old_sp := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT jsonb_object_agg(k, d||'/'||n), md5(string_agg(k||':'||d||':'||n, ',' ORDER BY k)) INTO fp, fp_all FROM (SELECT k, md5(string_agg(v, E'\n' ORDER BY v)) AS d, count(*) AS n FROM (
SELECT 'fn' AS k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||p.prokind::text||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||p.proleakproof||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::regtype::text||'|'||coalesce(p.proconfig::text,'')||'|'||md5(p.prosrc)||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') AS v
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'rel', n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||c.relpersistence::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, pg_get_userbyid(a.grantor)) FROM aclexplode(coalesce(c.relacl, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public') AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
UNION ALL
SELECT 'col', c.relname||'.'||a.attname||'|'||format_type(a.atttypid, a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin, d.adrelid),'')||'|'||a.attidentity::text||'|'||a.attgenerated::text||'|'||
  coalesce((SELECT string_agg(x.privilege_type||':'||CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY x.privilege_type, CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) FROM aclexplode(a.attacl) x), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'con', conrelid::regclass::text||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
UNION ALL
SELECT 'idx', schemaname||'.'||tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'trg', tgrelid::regclass::text||'|'||tgname||'|'||tgenabled::text||'|'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid::regclass::text LIKE 'public.%' OR tgrelid::regclass::text IN ('auth.users','storage.objects','storage.buckets') OR tgrelid::regclass::text NOT LIKE '%.%')
UNION ALL
SELECT 'pol', schemaname||'.'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_policies WHERE schemaname IN ('public','storage')
UNION ALL
SELECT 'nsp', nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a), '')
FROM pg_namespace WHERE nspname IN ('public','storage')
UNION ALL
SELECT 'dacl', pg_get_userbyid(defaclrole)||'|'||coalesce(defaclnamespace::regnamespace::text,'global')||'|'||defaclobjtype::text||'|'||
  coalesce((SELECT string_agg(a.privilege_type||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) FROM aclexplode(defaclacl) a), '') FROM pg_default_acl WHERE defaclnamespace = 0 OR defaclnamespace = 'public'::regnamespace
UNION ALL
SELECT 'bkt', id||'|'||public||'|'||coalesce(file_size_limit::text,'null')||'|'||coalesce(allowed_mime_types::text,'null') FROM storage.buckets
UNION ALL
SELECT 'pub', pubname||'|'||schemaname||'.'||tablename FROM pg_publication_tables
UNION ALL
SELECT 'ext', extname||'|'||extnamespace::regnamespace::text FROM pg_extension WHERE extname <> 'supabase_vault'
) f GROUP BY k ORDER BY k) z;
  PERFORM set_config('search_path', old_sp, true);

  IF fp_all IS DISTINCT FROM '181501065d3c5a965f5d300c54f9fbd8' THEN RAISE EXCEPTION 'BPC-EXECUTOR %: catalog fingerprint mismatch for 20261016120000 (expected 181501065d3c5a965f5d300c54f9fbd8, observed %), categories: %', 'post', fp_all, fp USING ERRCODE = 'P0001'; END IF;
  IF NOT (NOT has_schema_privilege('anon', 'public', 'USAGE') AND NOT has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'BPC-EXECUTOR: 20261016120000 left the schema uncontained'; END IF;
  IF NOT COALESCE((SELECT NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)), false) THEN RAISE EXCEPTION 'BPC-EXECUTOR: postcondition failed for 20261016120000: rls-on-every-public-table'; END IF;
END $bpcpost$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261016120000', 'repair_role_assignment_and_signup_provisioning', ARRAY['-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT; step=12/28; version=20261016120000; package_sha256=5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0; sha256_lf=2ca02e10dfa040575798c71ef30bf605f6a7ad8b54918928e99a41f7deb6970b', $bpcsql$/*
  # Repair role assignment and signup provisioning

  ## Problems
  1. assign_role_by_email (Admin > Permissions > Add user by email) used ON CONFLICT (user_id). public.user_roles is unique on
     (user_id, role) only, so PostgreSQL rejects the statement ("there is no unique or exclusion constraint matching the
     ON CONFLICT specification") and the function failed for every existing user.
  2. auto_assign_customer_role (the signup trigger function) used the same invalid arbiter for its role step. Its exception
     handler swallowed the error, so a new signup completed WITHOUT a role, a customer, a contact or a profile.
  3. assign_role_by_email compared the requested role case-sensitively (p_role = 'master'). Repairing only the arbiter would have
     let an Admin grant the master role by sending 'MASTER' (every other authorization helper compares lower(role)).
  4. The repository defined a CHECK on user_roles.role that accepts only UPPERCASE values, while the application, the RLS
     policies, user_permissions_changelog and the Edge Functions all use lowercase (master, admin, crew, customer). A fresh
     replay rejected the application's own writes. Dev has neither that CHECK nor the original foreign key to auth.users.
  5. The auth.users trigger that runs the signup function is absent on Dev.
  6. The signup function writes customer_profiles.first_name / last_name. Migration 20251229223230
     (update_customer_profiles_names) already adds them (the table was built with display_name), so they exist on Production,
     on Dev and in a replay; the ADD COLUMN IF NOT EXISTS below only keeps this migration self-contained.

  ## What this migration does
  - Canonical role vocabulary, stored in ONE form: master, admin, crew, customer (lowercase).
  - Normalizes any existing role value by trimming and lowercasing it (dropping a row only when normalizing would duplicate
    another row of the same user), and REFUSES to continue if any value is still outside the vocabulary, so nothing is guessed.
  - Replaces the role CHECK with the lowercase vocabulary.
  - Removes role rows whose auth user no longer exists (they can never match a signed-in user) and restores the foreign key
    user_roles.user_id -> auth.users(id) ON DELETE CASCADE. It refuses to delete anything if auth.users is empty.
  - assign_role_by_email: normalizes the requested role first (trim, lowercase, allowlist master / admin / crew), authorizes with
    the NORMALIZED role, derives the caller's strongest role from all of their rows (master outranks admin), keeps an Admin from
    changing an existing admin or master, and replaces the target's role atomically with exactly the requested one. An unknown
    email still returns false.
  - auto_assign_customer_role: only the role step changes. It gives the customer role to a user who has no role, and never
    replaces or adds to an existing one. Everything else the function does is unchanged, including its error handling.
  - Adds customer_profiles.first_name and last_name when they are missing (a no-op on Dev, where they already exist). The
    older display_name column is left alone.
  - Recreates the single intended trigger on_auth_user_created (AFTER INSERT ON auth.users -> auto_assign_customer_role()).

  ## What it does NOT do
  No UNIQUE (user_id) is added (UNIQUE (user_id, role) is kept). get_user_role, the older multi-role helpers, default
  privileges, and every other function grant are untouched.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Existing data: one canonical lowercase form, no stale rows
-- ---------------------------------------------------------------------------------------------------------------------
-- Drop every CHECK that constrains the role column (whatever it was called) BEFORE normalizing: a legacy CHECK that accepts only
-- UPPERCASE roles would reject the lowercase values written below. The lowercase CHECK is added after the vocabulary guard.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~* '\mrole\M'
  LOOP
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  -- Rows that would become duplicates of another row of the same user once normalized: keep the earliest.
  DELETE FROM public.user_roles a
  USING public.user_roles b
  WHERE a.user_id = b.user_id
    AND a.id <> b.id
    AND lower(btrim(a.role)) = lower(btrim(b.role))
    AND (coalesce(a.created_at, '-infinity'::timestamptz), a.id) > (coalesce(b.created_at, '-infinity'::timestamptz), b.id);

  UPDATE public.user_roles SET role = lower(btrim(role)) WHERE role <> lower(btrim(role));

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role NOT IN ('master', 'admin', 'crew', 'customer')) THEN
    RAISE EXCEPTION 'user_roles contains a role outside master / admin / crew / customer; review those rows before applying this migration';
  END IF;
END $$;

-- Canonical CHECK, added only after every row has been normalized and validated above.
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check CHECK (role IN ('master', 'admin', 'crew', 'customer'));

-- Role rows for an auth user that no longer exists can never match a signed-in user. Remove them, then restore the original
-- foreign key (skipped when a foreign key from user_roles.user_id to auth.users already exists, under any name).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users) THEN
      RAISE EXCEPTION 'auth.users is empty; refusing to treat every user_roles row as an orphan';
    END IF;

    DELETE FROM public.user_roles ur
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id);

    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. assign_role_by_email
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_role_by_email(p_email text, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_role        text;
  v_target_id   uuid;
  v_keep        uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Only admin or master users can assign roles';
  END IF;

  -- The caller's strongest role, read from ALL of their rows (never an arbitrary one): master outranks admin.
  SELECT CASE
           WHEN bool_or(lower(btrim(role)) = 'master') THEN 'master'
           WHEN bool_or(lower(btrim(role)) = 'admin') THEN 'admin'
         END
  INTO v_caller_role
  FROM public.user_roles
  WHERE user_id = v_caller_id;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Only admin or master users can assign roles';
  END IF;

  -- Normalize FIRST. Every check below uses this value, so 'MASTER', 'Master', ' master ' and 'master' are one request.
  v_role := lower(btrim(p_role, E' \t\r\n'));
  IF v_role IS NULL OR v_role NOT IN ('master', 'admin', 'crew') THEN
    RAISE EXCEPTION 'Invalid role: only master, admin or crew can be assigned';
  END IF;

  IF v_role = 'master' AND v_caller_role <> 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the master role';
  END IF;

  IF v_role = 'admin' AND v_caller_role <> 'master' THEN
    RAISE EXCEPTION 'Only master users can assign the admin role';
  END IF;

  SELECT id INTO v_target_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(p_email, E' \t\r\n'))
  ORDER BY created_at, id
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN false;
  END IF;

  -- One assignment at a time per target user.
  PERFORM pg_advisory_xact_lock(hashtextextended('user_roles:' || v_target_id::text, 0));

  -- An Admin cannot change a user who is an admin or a master (the Permissions screen applies the same rule).
  IF v_caller_role <> 'master' AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_target_id AND lower(btrim(role)) IN ('master', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only master users can change an admin or master';
  END IF;

  -- Replace the target's role with exactly the requested one. user_roles is unique on (user_id, role), so this is done with
  -- the row that already holds the requested role (else the oldest row), removing any other rows the user unexpectedly has.
  SELECT id INTO v_keep
  FROM public.user_roles
  WHERE user_id = v_target_id
  ORDER BY (lower(btrim(role)) = v_role) DESC, created_at, id
  LIMIT 1;

  IF v_keep IS NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_target_id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = v_target_id AND id <> v_keep;
    UPDATE public.user_roles SET role = v_role WHERE id = v_keep AND role <> v_role;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_role_by_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_role_by_email(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. auto_assign_customer_role (signup provisioning): only the role step changes
-- ---------------------------------------------------------------------------------------------------------------------

-- The signup function stores the customer's name in customer_profiles.first_name / last_name. Migration 20251229223230
-- (update_customer_profiles_names) already adds them, so this is a no-op wherever that migration was applied.
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

CREATE OR REPLACE FUNCTION public.auto_assign_customer_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_customer_id uuid;
  existing_contact_id  uuid;
  new_address_id       uuid;
  user_email           text;
  user_full_name       text;
  user_first_name      text;
  user_last_name       text;
  user_phone           text;
  v_oauth_provider     text;
  profile_data         jsonb;
  v_step               text := 'init';
  v_error_message      text;
BEGIN
  user_email := NEW.email;

  -- Explicit first_name/last_name from signup form take priority over Google full_name
  user_first_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), '');
  user_last_name  := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), '');

  -- Only fall back to parsing name/full_name if explicit fields were not provided
  IF user_first_name IS NULL THEN
    user_full_name  := COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    );
    user_first_name := split_part(user_full_name, ' ', 1);
    user_last_name  := CASE WHEN position(' ' IN user_full_name) > 0
      THEN split_part(user_full_name, ' ', 2)
      ELSE COALESCE(user_last_name, '')
    END;
  END IF;

  user_phone       := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  v_oauth_provider := NEW.raw_app_meta_data->>'provider';

  profile_data := jsonb_build_object(
    'name',       COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'picture',    COALESCE(NEW.raw_user_meta_data->>'picture', ''),
    'email',      user_email,
    'locale',     COALESCE(NEW.raw_user_meta_data->>'locale', ''),
    'provider',   v_oauth_provider
  );

  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
  VALUES (
    NEW.id, user_email, 'trigger_start', 'started',
    'Auto-assign customer role trigger started',
    jsonb_build_object(
      'first_name', user_first_name, 'last_name', user_last_name,
      'phone', user_phone, 'provider', v_oauth_provider
    )
  );

  -- Give the new user the customer role - but only a user who has no role yet. user_roles is unique on (user_id, role), not on
  -- user_id alone, so the old ON CONFLICT (user_id) could never be planned and failed every signup at this step. A user who
  -- already holds ANY role (master, admin, crew, or customer) keeps it: this trigger never replaces or adds to an existing role.
  v_step := 'insert_user_role';
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, 'customer'
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.id)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Look up existing customer by email
  v_step := 'lookup_customer';
  SELECT id INTO existing_customer_id
  FROM public.customers
  WHERE email = user_email
  LIMIT 1;

  IF existing_customer_id IS NOT NULL THEN
    -- Link user_id and update OAuth data, but also update name if signup form provided explicit values
    v_step := 'update_existing_customer';
    UPDATE public.customers
    SET
      user_id            = NEW.id,
      oauth_provider     = v_oauth_provider,
      oauth_profile_data = profile_data,
      -- Update first/last name only when the incoming value is non-empty
      -- (signup form data wins over whatever was previously stored)
      first_name         = CASE WHEN COALESCE(NULLIF(TRIM(user_first_name), ''), '') != ''
                             THEN user_first_name
                             ELSE first_name END,
      last_name          = CASE WHEN COALESCE(NULLIF(TRIM(user_last_name), ''), '') != ''
                             THEN user_last_name
                             ELSE last_name END,
      phone              = COALESCE(NULLIF(customers.phone, ''), user_phone)
    WHERE id = existing_customer_id;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
    VALUES (NEW.id, user_email, v_step, 'success', 'Linked user_id to existing customer');

    v_step := 'create_contact_for_customer';
    INSERT INTO public.contacts (customer_id, first_name, last_name, email, phone, source, total_bookings)
    VALUES (
      existing_customer_id, user_first_name, user_last_name,
      user_email, user_phone, 'signup',
      (SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id)
    )
    ON CONFLICT (email) DO UPDATE SET
      first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                     THEN EXCLUDED.first_name ELSE contacts.first_name END,
      last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                     THEN EXCLUDED.last_name ELSE contacts.last_name END,
      last_contact_date = now()
    RETURNING id INTO existing_contact_id;

    IF existing_contact_id IS NULL THEN
      SELECT id INTO existing_contact_id FROM public.contacts WHERE email = user_email LIMIT 1;
    END IF;

  ELSE
    -- Create customer + contact from scratch
    IF existing_contact_id IS NULL AND existing_customer_id IS NULL THEN
      v_step := 'create_new_customer';
      INSERT INTO public.customers (user_id, first_name, last_name, email, phone, oauth_provider, oauth_profile_data)
      VALUES (
        NEW.id, user_first_name, user_last_name,
        user_email, user_phone, v_oauth_provider, profile_data
      )
      ON CONFLICT (email) DO UPDATE
      SET
        user_id            = NEW.id,
        oauth_provider     = EXCLUDED.oauth_provider,
        oauth_profile_data = EXCLUDED.oauth_profile_data,
        first_name         = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                               THEN EXCLUDED.first_name ELSE customers.first_name END,
        last_name          = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                               THEN EXCLUDED.last_name ELSE customers.last_name END
      RETURNING id INTO existing_customer_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, v_step, 'success', 'Created new customer record');

      -- Google address extraction
      IF v_oauth_provider = 'google' AND profile_data ? 'address' THEN
        v_step := 'create_google_address';
        BEGIN
          INSERT INTO public.addresses (user_id, line1, city, state, zip, is_default)
          SELECT NEW.id,
                 profile_data->'address'->>'street_address',
                 profile_data->'address'->>'locality',
                 profile_data->'address'->>'region',
                 profile_data->'address'->>'postal_code',
                 true
          WHERE profile_data->'address'->>'street_address' IS NOT NULL
            AND profile_data->'address'->>'locality' IS NOT NULL
          ON CONFLICT DO NOTHING;

          IF FOUND THEN
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
            VALUES (NEW.id, user_email, v_step, 'success', 'Created address from Google profile');
          ELSE
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
            VALUES (NEW.id, user_email, v_step, 'skipped', 'Insufficient address data from Google');
          END IF;
        EXCEPTION WHEN OTHERS THEN
          INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
          VALUES (NEW.id, user_email, v_step, 'skipped', 'Could not extract address from Google profile');
        END;
      END IF;

      v_step := 'create_new_contact';
      INSERT INTO public.contacts (customer_id, first_name, last_name, email, phone, source, total_bookings)
      VALUES (existing_customer_id, user_first_name, user_last_name, user_email, user_phone, 'signup', 0)
      ON CONFLICT (email) DO UPDATE SET
        first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                       THEN EXCLUDED.first_name ELSE contacts.first_name END,
        last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                       THEN EXCLUDED.last_name ELSE contacts.last_name END,
        last_contact_date = now()
      RETURNING id INTO existing_contact_id;

      IF existing_contact_id IS NULL THEN
        SELECT id INTO existing_contact_id FROM public.contacts WHERE email = user_email LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- Create customer_profile (first_name/last_name from signup form take priority)
  v_step := 'create_customer_profile';
  INSERT INTO public.customer_profiles (user_id, contact_id, first_name, last_name, phone)
  VALUES (NEW.id, existing_contact_id, user_first_name, user_last_name, user_phone)
  ON CONFLICT (user_id) DO UPDATE
  SET contact_id = EXCLUDED.contact_id,
      first_name = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.first_name), ''), '') != ''
                     THEN EXCLUDED.first_name ELSE customer_profiles.first_name END,
      last_name  = CASE WHEN COALESCE(NULLIF(TRIM(EXCLUDED.last_name), ''), '') != ''
                     THEN EXCLUDED.last_name ELSE customer_profiles.last_name END,
      phone      = EXCLUDED.phone,
      updated_at = now();

  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
  VALUES (NEW.id, user_email, 'trigger_complete', 'success', 'Trigger completed successfully');

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
  VALUES (NEW.id, NEW.email, v_step, 'error', v_error_message)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_assign_customer_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_customer_role() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The one signup trigger
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  -- A second trigger running the same function under another name would provision every signup twice.
  FOR t IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
      AND tgfoid = 'public.auto_assign_customer_role()'::regprocedure
      AND tgname <> 'on_auth_user_created'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users', t.tgname);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_customer_role();
$bpcsql$]);
DO $bpcend$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 317 THEN RAISE EXCEPTION 'BPC-EXECUTOR: unexpected ledger count after 20261016120000'; END IF;
END $bpcend$;
