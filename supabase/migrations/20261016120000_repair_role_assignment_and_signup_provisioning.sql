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
  6. The signup function writes customer_profiles.first_name / last_name, columns the repository migrations never create (the
     table was built with display_name). Dev already has them; a fresh replay does not, so signup failed at that step too.

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

-- Replace every CHECK that constrains the role column (whatever it was called) with the lowercase vocabulary.
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

-- The signup function stores the customer's name in customer_profiles.first_name / last_name. Dev has these columns; the
-- repository migrations never created them.
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
