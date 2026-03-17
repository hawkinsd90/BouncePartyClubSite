/*
  # Provision address from signup raw_user_meta_data in auth trigger

  ## Summary
  When a user signs up with an address via supabase.auth.signUp options.data, those
  address fields are stored in auth.users.raw_user_meta_data. This migration updates
  the auto_assign_customer_role trigger to:

  1. Read address fields (address_line1, address_line2, city, state, zip, lat, lng)
     from raw_user_meta_data during user creation
  2. Create an addresses row for the customer when these fields are present
  3. Set customers.default_address_id to that address

  This makes address provisioning server-side and idempotent. No localStorage,
  no edge function calls on the confirmation flow. The trigger already runs with
  SECURITY DEFINER so it can write to addresses without RLS interference.

  Also reads business_name from raw_user_meta_data and writes it to customers.

  ## Changes
  - auto_assign_customer_role(): extended to read address + business_name from metadata
  - create_new_customer step: now includes business_name column
  - new step: create_signup_address — runs after customer row is established
*/

CREATE OR REPLACE FUNCTION auto_assign_customer_role()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, auth
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
  user_business_name   text;
  v_oauth_provider     text;
  profile_data         jsonb;
  v_step               text;
  v_error_message      text;
  -- address fields from signup metadata
  signup_addr_line1    text;
  signup_addr_line2    text;
  signup_addr_city     text;
  signup_addr_state    text;
  signup_addr_zip      text;
  signup_addr_lat      numeric;
  signup_addr_lng      numeric;
  signup_addr_key      text;
BEGIN
  user_email      := NEW.email;
  user_full_name  := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  user_first_name := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    split_part(user_full_name, ' ', 1)
  );
  user_last_name  := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    CASE WHEN position(' ' IN user_full_name) > 0
      THEN split_part(user_full_name, ' ', 2)
      ELSE ''
    END
  );
  user_phone           := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', '');
  user_business_name   := NEW.raw_user_meta_data->>'business_name';
  v_oauth_provider     := NEW.raw_app_meta_data->>'provider';
  profile_data         := NEW.raw_user_meta_data;

  -- Read address fields from signup metadata
  signup_addr_line1 := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'address_line1', '')), '');
  signup_addr_line2 := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'address_line2', '')), '');
  signup_addr_city  := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'address_city', '')), '');
  signup_addr_state := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'address_state', '')), '');
  signup_addr_zip   := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'address_zip', '')), '');
  signup_addr_lat   := NULLIF(NEW.raw_user_meta_data->>'address_lat', '')::numeric;
  signup_addr_lng   := NULLIF(NEW.raw_user_meta_data->>'address_lng', '')::numeric;

  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
  VALUES (
    NEW.id, user_email, 'trigger_start', 'started',
    'Auto-assign customer role trigger started',
    jsonb_build_object(
      'first_name', user_first_name, 'last_name', user_last_name,
      'phone', user_phone, 'provider', v_oauth_provider,
      'has_signup_address', signup_addr_line1 IS NOT NULL
    )
  );

  BEGIN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, 'check_existing_roles', 'skipped', 'User already has roles assigned');
      RETURN NEW;
    END IF;

    v_step := 'assign_customer_role';
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'CUSTOMER')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
    VALUES (NEW.id, user_email, v_step, 'success', 'CUSTOMER role assigned');

    -- Find existing contact by email
    v_step := 'find_existing_contact';
    SELECT id, customer_id INTO existing_contact_id, existing_customer_id
    FROM public.contacts
    WHERE email = user_email
    LIMIT 1;

    IF existing_contact_id IS NOT NULL THEN
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (NEW.id, user_email, v_step, 'success', 'Found existing contact',
        jsonb_build_object('contact_id', existing_contact_id, 'customer_id', existing_customer_id));
    ELSE
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, v_step, 'skipped', 'No existing contact found');
    END IF;

    -- If no contact, try to find customer by email
    IF existing_contact_id IS NULL THEN
      v_step := 'find_existing_customer';
      SELECT id INTO existing_customer_id FROM public.customers WHERE email = user_email LIMIT 1;

      IF existing_customer_id IS NOT NULL THEN
        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
        VALUES (NEW.id, user_email, v_step, 'success', 'Found existing customer without contact',
          jsonb_build_object('customer_id', existing_customer_id));

        v_step := 'link_user_to_customer';
        UPDATE public.customers
        SET
          user_id            = NEW.id,
          oauth_provider     = v_oauth_provider,
          oauth_profile_data = profile_data,
          phone              = COALESCE(NULLIF(customers.phone, ''), user_phone),
          business_name      = COALESCE(customers.business_name, user_business_name)
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
        ON CONFLICT (email) DO UPDATE SET last_contact_date = now()
        RETURNING id INTO existing_contact_id;

        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
        VALUES (NEW.id, user_email, v_step, 'success', 'Created/updated contact for existing customer',
          jsonb_build_object('contact_id', existing_contact_id));
      ELSE
        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
        VALUES (NEW.id, user_email, v_step, 'skipped', 'No existing customer found');
      END IF;
    END IF;

    -- If still nothing, create customer + contact from scratch
    IF existing_contact_id IS NULL AND existing_customer_id IS NULL THEN
      v_step := 'create_new_customer';
      INSERT INTO public.customers (
        user_id, first_name, last_name, email, phone,
        business_name, oauth_provider, oauth_profile_data
      )
      VALUES (
        NEW.id, user_first_name, user_last_name,
        user_email, user_phone,
        user_business_name, v_oauth_provider, profile_data
      )
      ON CONFLICT (email) DO UPDATE
      SET
        user_id            = NEW.id,
        business_name      = COALESCE(customers.business_name, EXCLUDED.business_name),
        oauth_provider     = EXCLUDED.oauth_provider,
        oauth_profile_data = EXCLUDED.oauth_profile_data
      RETURNING id INTO existing_customer_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (NEW.id, user_email, v_step, 'success', 'Created new customer',
        jsonb_build_object('customer_id', existing_customer_id));

      -- Google OAuth address extraction (existing behaviour, unchanged)
      IF v_oauth_provider = 'google' AND profile_data ? 'address' THEN
        v_step := 'create_google_address';
        DECLARE
          addr_line1 text;
          addr_city  text;
          addr_state text;
          addr_zip   text;
        BEGIN
          addr_line1 := profile_data->'address'->>'street_address';
          addr_city  := profile_data->'address'->>'locality';
          addr_state := profile_data->'address'->>'region';
          addr_zip   := profile_data->'address'->>'postal_code';
          IF addr_city IS NOT NULL AND addr_state IS NOT NULL THEN
            INSERT INTO public.addresses (customer_id, line1, city, state, zip)
            VALUES (existing_customer_id, COALESCE(addr_line1,''), addr_city, addr_state, COALESCE(addr_zip,''))
            RETURNING id INTO new_address_id;
            UPDATE public.customers SET default_address_id = new_address_id WHERE id = existing_customer_id;
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
            VALUES (NEW.id, user_email, v_step, 'success', 'Created address from Google profile',
              jsonb_build_object('address_id', new_address_id));
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
      ON CONFLICT (email) DO UPDATE SET last_contact_date = now()
      RETURNING id INTO existing_contact_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (NEW.id, user_email, v_step, 'success', 'Created new contact',
        jsonb_build_object('contact_id', existing_contact_id));
    END IF;

    -- Create address from signup metadata (email/password signup path)
    -- Only runs when address fields were provided at signup AND no default address has been set yet
    IF signup_addr_line1 IS NOT NULL AND signup_addr_city IS NOT NULL
       AND signup_addr_state IS NOT NULL AND signup_addr_zip IS NOT NULL
       AND existing_customer_id IS NOT NULL
    THEN
      -- Only set if customer has no default address already (Google OAuth may have set one)
      IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = existing_customer_id AND default_address_id IS NOT NULL) THEN
        v_step := 'create_signup_address';

        signup_addr_key := lower(signup_addr_line1) || '|' ||
                           lower(signup_addr_city) || '|' ||
                           upper(signup_addr_state) || '|' ||
                           replace(signup_addr_zip, ' ', '');

        INSERT INTO public.addresses (
          customer_id, line1, line2, city, state, zip, lat, lng, address_key
        )
        VALUES (
          existing_customer_id,
          signup_addr_line1,
          signup_addr_line2,
          signup_addr_city,
          signup_addr_state,
          signup_addr_zip,
          signup_addr_lat,
          signup_addr_lng,
          signup_addr_key
        )
        ON CONFLICT (address_key) DO UPDATE
          SET lat = COALESCE(EXCLUDED.lat, addresses.lat),
              lng = COALESCE(EXCLUDED.lng, addresses.lng)
        RETURNING id INTO new_address_id;

        UPDATE public.customers
        SET default_address_id = new_address_id
        WHERE id = existing_customer_id;

        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
        VALUES (NEW.id, user_email, v_step, 'success', 'Created address from signup metadata',
          jsonb_build_object('address_id', new_address_id));
      ELSE
        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
        VALUES (NEW.id, user_email, 'create_signup_address', 'skipped', 'Customer already has a default address');
      END IF;
    END IF;

    -- Create customer_profile
    v_step := 'create_customer_profile';
    INSERT INTO public.customer_profiles (user_id, contact_id, first_name, last_name, phone)
    VALUES (NEW.id, existing_contact_id, user_first_name, user_last_name, user_phone)
    ON CONFLICT (user_id) DO UPDATE
    SET contact_id = EXCLUDED.contact_id,
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        phone      = EXCLUDED.phone,
        updated_at = now();

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (NEW.id, user_email, v_step, 'success', 'Created/updated customer profile',
      jsonb_build_object('contact_id', existing_contact_id));

    -- Update contact stats
    IF existing_customer_id IS NOT NULL AND existing_contact_id IS NOT NULL THEN
      v_step := 'update_contact_stats';
      UPDATE public.contacts
      SET
        total_bookings = (SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id),
        total_spent_cents = (
          SELECT COALESCE(SUM(
            COALESCE(subtotal_cents,0) + COALESCE(travel_fee_cents,0) +
            COALESCE(surface_fee_cents,0) + COALESCE(same_day_pickup_fee_cents,0) +
            COALESCE(generator_fee_cents,0) + COALESCE(tax_cents,0)
          ), 0)
          FROM public.orders
          WHERE customer_id = existing_customer_id AND status IN ('confirmed','completed')
        ),
        last_contact_date = now()
      WHERE id = existing_contact_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, v_step, 'success', 'Updated contact statistics');
    END IF;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (NEW.id, user_email, 'trigger_complete', 'success', 'User creation completed successfully',
      jsonb_build_object('customer_id', existing_customer_id, 'contact_id', existing_contact_id,
                         'address_id', new_address_id));

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (NEW.id, user_email, v_step, 'error', v_error_message,
      jsonb_build_object('sqlstate', SQLSTATE));
    RAISE WARNING 'Error in auto_assign_customer_role for user %: %', NEW.id, v_error_message;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;
