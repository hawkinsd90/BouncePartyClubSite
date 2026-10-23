-- BPC-DEV-MIGRATION AUTH-18 20261027150000 20261027150000_require_start_mileage_setting.sql; bound by the owner authorization that quotes this file's SHA-256
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));
DO $bpc$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'wrong database or role'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 378 THEN RAISE EXCEPTION 'ledger count differs from the verified ledger'; END IF;
  IF (SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\n'),'')), E'\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations) <> 'c2bcec85c4f4fe02ec63ae4731547a6f8d9bfef1c054e063ada6049d4ab432f8' THEN RAISE EXCEPTION 'ledger content differs from the verified ledger'; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027150000') THEN RAISE EXCEPTION 'version already recorded'; END IF;
  IF NOT (has_schema_privilege('anon', 'public', 'USAGE') AND has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'S11 end state is not in force'; END IF;
  IF NOT COALESCE((NOT EXISTS (SELECT 1 FROM public.admin_settings WHERE key = 'require_start_mileage')), false) THEN RAISE EXCEPTION 'precondition 1 failed'; END IF;
  PERFORM set_config('bpc.anon_fn_before', ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')))::text, true);
  PERFORM set_config('bpc.anon_tbl_before', ((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))))::text, true);
END $bpc$;
-- ---- the reviewed migration, byte for byte ----
/*
  # Public settings: start-mileage requirement (and the two evidence-photo requirements)

  ## Purpose
  The Crew task screens ("En Route", "Arrived", "Complete delivery", "Complete pickup") require a start-of-day mileage
  reading. The owner needs to switch that requirement off. Crew cannot read admin_settings (it holds credentials), so the
  setting is exposed through the existing whitelist function get_public_business_settings(), which every signed-in
  role can call.

  ## What this changes
  - Seeds three non-secret settings (only when they do not exist yet):
      require_start_mileage    'true'
      require_delivery_photo   'true'   (used by a later change; seeded now so this function is replaced once)
      require_pickup_photo     'true'   (used by a later change)
  - Replaces public.get_public_business_settings(): the 15 keys it already returns, unchanged, plus the three above.

  ## Security
  - The allow-list stays a hard-coded list inside the function; no secret-looking key is added.
  - SECURITY DEFINER with search_path = public is retained. Execute stays revoked from PUBLIC and granted to
    anon, authenticated and service_role (the grants the function has today, plus service_role).
  - admin_settings policies are NOT changed: crew still reads no admin_settings rows directly.
  - Idempotent: safe to run twice. A missing or unreadable value is treated as "required" by the application (fail closed).
*/

INSERT INTO public.admin_settings (key, value)
VALUES
  ('require_start_mileage', 'true'),
  ('require_delivery_photo', 'true'),
  ('require_pickup_photo', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_public_business_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
  allowed_keys text[] := ARRAY[
    'business_name',
    'business_phone',
    'business_email',
    'logo_url',
    'instagram_url',
    'facebook_url',
    'business_address',
    'home_address_line1',
    'home_address_line2',
    'home_address_city',
    'home_address_state',
    'home_address_zip',
    'event_essentials_page_enabled',
    'min_event_essentials_order_cents',
    'how_did_you_hear_enabled',
    'require_start_mileage',
    'require_delivery_photo',
    'require_pickup_photo'
  ];
  rec record;
BEGIN
  FOR rec IN
    SELECT key, value
    FROM public.admin_settings
    WHERE key = ANY(allowed_keys)
  LOOP
    result := result || jsonb_build_object(rec.key, rec.value);
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_business_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO service_role;
-- ---- end of the reviewed migration ----
DO $bpc$
BEGIN
  IF NOT COALESCE(((SELECT count(*) FROM public.admin_settings WHERE key IN ('require_start_mileage','require_delivery_photo','require_pickup_photo')) = 3), false) THEN RAISE EXCEPTION 'postcondition 1 failed'; END IF;
  IF NOT COALESCE((jsonb_exists(public.get_public_business_settings(), 'require_start_mileage')), false) THEN RAISE EXCEPTION 'postcondition 2 failed'; END IF;
  IF NOT COALESCE((has_function_privilege('anon','public.get_public_business_settings()','EXECUTE') AND has_function_privilege('authenticated','public.get_public_business_settings()','EXECUTE')), false) THEN RAISE EXCEPTION 'postcondition 3 failed'; END IF;
  IF NOT COALESCE((NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = 'public.get_public_business_settings()'::regprocedure AND a.grantee = 0)), false) THEN RAISE EXCEPTION 'postcondition 4 failed'; END IF;
  IF ((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')))::text <> current_setting('bpc.anon_fn_before') THEN RAISE EXCEPTION 'the set of functions anon can execute changed'; END IF;
  IF ((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))))::text <> current_setting('bpc.anon_tbl_before') THEN RAISE EXCEPTION 'the set of tables anon can touch changed'; END IF;
END $bpc$;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261027150000', 'require_start_mileage_setting', ARRAY[$bpcm$-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18); version=20261027150000; file=20261027150000_require_start_mileage_setting.sql; file_sha256=a543331b0c4922f0df15c34d7f9baf6d94a229d03e822c0673a2aad39633c9b5; the exact file text follows as statements[2]$bpcm$, $bpcsql$/*
  # Public settings: start-mileage requirement (and the two evidence-photo requirements)

  ## Purpose
  The Crew task screens ("En Route", "Arrived", "Complete delivery", "Complete pickup") require a start-of-day mileage
  reading. The owner needs to switch that requirement off. Crew cannot read admin_settings (it holds credentials), so the
  setting is exposed through the existing whitelist function get_public_business_settings(), which every signed-in
  role can call.

  ## What this changes
  - Seeds three non-secret settings (only when they do not exist yet):
      require_start_mileage    'true'
      require_delivery_photo   'true'   (used by a later change; seeded now so this function is replaced once)
      require_pickup_photo     'true'   (used by a later change)
  - Replaces public.get_public_business_settings(): the 15 keys it already returns, unchanged, plus the three above.

  ## Security
  - The allow-list stays a hard-coded list inside the function; no secret-looking key is added.
  - SECURITY DEFINER with search_path = public is retained. Execute stays revoked from PUBLIC and granted to
    anon, authenticated and service_role (the grants the function has today, plus service_role).
  - admin_settings policies are NOT changed: crew still reads no admin_settings rows directly.
  - Idempotent: safe to run twice. A missing or unreadable value is treated as "required" by the application (fail closed).
*/

INSERT INTO public.admin_settings (key, value)
VALUES
  ('require_start_mileage', 'true'),
  ('require_delivery_photo', 'true'),
  ('require_pickup_photo', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_public_business_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
  allowed_keys text[] := ARRAY[
    'business_name',
    'business_phone',
    'business_email',
    'logo_url',
    'instagram_url',
    'facebook_url',
    'business_address',
    'home_address_line1',
    'home_address_line2',
    'home_address_city',
    'home_address_state',
    'home_address_zip',
    'event_essentials_page_enabled',
    'min_event_essentials_order_cents',
    'how_did_you_hear_enabled',
    'require_start_mileage',
    'require_delivery_photo',
    'require_pickup_photo'
  ];
  rec record;
BEGIN
  FOR rec IN
    SELECT key, value
    FROM public.admin_settings
    WHERE key = ANY(allowed_keys)
  LOOP
    result := result || jsonb_build_object(rec.key, rec.value);
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_business_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO service_role;
$bpcsql$]);
DO $bpc$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 379 THEN RAISE EXCEPTION 'unexpected ledger count after the migration'; END IF;
  IF (SELECT statements[2] FROM supabase_migrations.schema_migrations WHERE version = '20261027150000') <> $bpcsql$/*
  # Public settings: start-mileage requirement (and the two evidence-photo requirements)

  ## Purpose
  The Crew task screens ("En Route", "Arrived", "Complete delivery", "Complete pickup") require a start-of-day mileage
  reading. The owner needs to switch that requirement off. Crew cannot read admin_settings (it holds credentials), so the
  setting is exposed through the existing whitelist function get_public_business_settings(), which every signed-in
  role can call.

  ## What this changes
  - Seeds three non-secret settings (only when they do not exist yet):
      require_start_mileage    'true'
      require_delivery_photo   'true'   (used by a later change; seeded now so this function is replaced once)
      require_pickup_photo     'true'   (used by a later change)
  - Replaces public.get_public_business_settings(): the 15 keys it already returns, unchanged, plus the three above.

  ## Security
  - The allow-list stays a hard-coded list inside the function; no secret-looking key is added.
  - SECURITY DEFINER with search_path = public is retained. Execute stays revoked from PUBLIC and granted to
    anon, authenticated and service_role (the grants the function has today, plus service_role).
  - admin_settings policies are NOT changed: crew still reads no admin_settings rows directly.
  - Idempotent: safe to run twice. A missing or unreadable value is treated as "required" by the application (fail closed).
*/

INSERT INTO public.admin_settings (key, value)
VALUES
  ('require_start_mileage', 'true'),
  ('require_delivery_photo', 'true'),
  ('require_pickup_photo', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_public_business_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
  allowed_keys text[] := ARRAY[
    'business_name',
    'business_phone',
    'business_email',
    'logo_url',
    'instagram_url',
    'facebook_url',
    'business_address',
    'home_address_line1',
    'home_address_line2',
    'home_address_city',
    'home_address_state',
    'home_address_zip',
    'event_essentials_page_enabled',
    'min_event_essentials_order_cents',
    'how_did_you_hear_enabled',
    'require_start_mileage',
    'require_delivery_photo',
    'require_pickup_photo'
  ];
  rec record;
BEGIN
  FOR rec IN
    SELECT key, value
    FROM public.admin_settings
    WHERE key = ANY(allowed_keys)
  LOOP
    result := result || jsonb_build_object(rec.key, rec.value);
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_business_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO service_role;
$bpcsql$ THEN RAISE EXCEPTION 'stored SQL differs from the file'; END IF;
END $bpc$;
