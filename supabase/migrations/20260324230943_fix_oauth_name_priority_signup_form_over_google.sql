/*
  # Fix OAuth Name Priority: Signup Form Over Google API

  ## Problem
  When a user signs up via Google OAuth, the trigger builds first_name/last_name
  from Google's `name`/`full_name` fields first (via COALESCE), ignoring any
  explicit first_name/last_name the user entered at signup. The ON CONFLICT
  update for existing customers also never updates first_name/last_name.

  ## Fix
  1. Prioritize explicit `first_name`/`last_name` from raw_user_meta_data BEFORE
     falling back to parsing `name`/`full_name` from Google.
  2. On ON CONFLICT (email) for existing customers, also update first_name/last_name
     when the incoming values are non-empty (signup form data should win).
  3. Same priority fix for customer_profiles ON CONFLICT upsert.
*/

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

  -- Insert user role
  v_step := 'insert_user_role';
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id) DO NOTHING;

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
