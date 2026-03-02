/*
  # Fix Auth Trigger to Link user_id to Customers

  1. Updates
    - Update auto_assign_customer_role() function to set user_id on customers table
    - This ensures users are properly linked to their customer records
    - Enables customer profile autofill based on user_id
*/

-- Update the trigger function to set user_id
CREATE OR REPLACE FUNCTION auto_assign_customer_role()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_customer_id uuid;
  existing_contact_id uuid;
  new_address_id uuid;
  user_email text;
  user_name text;
  user_phone text;
  oauth_provider text;
  profile_data jsonb;
  v_step text;
  v_error_message text;
BEGIN
  -- Get user info
  user_email := NEW.email;
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  user_phone := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone', '');
  oauth_provider := NEW.raw_app_meta_data->>'provider';
  profile_data := NEW.raw_user_meta_data;

  -- Log start
  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
  VALUES (
    NEW.id,
    user_email,
    'trigger_start',
    'started',
    'Auto-assign customer role trigger started',
    jsonb_build_object(
      'name', user_name,
      'phone', user_phone,
      'provider', oauth_provider
    )
  );

  BEGIN
    -- Check if user already has roles
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, 'check_existing_roles', 'skipped', 'User already has roles assigned');
      RETURN NEW;
    END IF;

    -- Step 1: Assign CUSTOMER role
    v_step := 'assign_customer_role';
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'CUSTOMER')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
    VALUES (NEW.id, user_email, v_step, 'success', 'CUSTOMER role assigned');

    -- Step 2: Find existing contact by email
    v_step := 'find_existing_contact';
    SELECT id, customer_id INTO existing_contact_id, existing_customer_id
    FROM public.contacts
    WHERE email = user_email
    LIMIT 1;

    IF existing_contact_id IS NOT NULL THEN
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (
        NEW.id, user_email, v_step, 'success',
        'Found existing contact',
        jsonb_build_object('contact_id', existing_contact_id, 'customer_id', existing_customer_id)
      );
    ELSE
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
      VALUES (NEW.id, user_email, v_step, 'skipped', 'No existing contact found');
    END IF;

    -- Step 3: If no contact, try to find customer by email
    IF existing_contact_id IS NULL THEN
      v_step := 'find_existing_customer';
      SELECT id INTO existing_customer_id
      FROM public.customers
      WHERE email = user_email
      LIMIT 1;

      IF existing_customer_id IS NOT NULL THEN
        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
        VALUES (
          NEW.id, user_email, v_step, 'success',
          'Found existing customer without contact',
          jsonb_build_object('customer_id', existing_customer_id)
        );

        -- **CRITICAL FIX**: Link user_id to existing customer
        v_step := 'link_user_to_customer';
        UPDATE public.customers
        SET
          user_id = NEW.id,
          oauth_provider = oauth_provider,
          oauth_profile_data = profile_data,
          phone = COALESCE(NULLIF(customers.phone, ''), user_phone)
        WHERE id = existing_customer_id;

        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
        VALUES (NEW.id, user_email, v_step, 'success', 'Linked user_id and updated customer with OAuth data');

        -- Step 4: Create contact for existing customer
        v_step := 'create_contact_for_customer';
        INSERT INTO public.contacts (
          customer_id, first_name, last_name, email, phone, source, total_bookings
        )
        VALUES (
          existing_customer_id,
          split_part(user_name, ' ', 1),
          CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
          user_email, user_phone, 'signup',
          (SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id)
        )
        ON CONFLICT (email) DO UPDATE SET updated_at = now()
        RETURNING id INTO existing_contact_id;

        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
        VALUES (
          NEW.id, user_email, v_step, 'success',
          'Created contact for existing customer',
          jsonb_build_object('contact_id', existing_contact_id)
        );
      ELSE
        INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
        VALUES (NEW.id, user_email, v_step, 'skipped', 'No existing customer found');
      END IF;
    END IF;

    -- Step 5: If still no contact/customer, create both
    IF existing_contact_id IS NULL AND existing_customer_id IS NULL THEN
      v_step := 'create_new_customer';
      INSERT INTO public.customers (
        user_id, first_name, last_name, email, phone, oauth_provider, oauth_profile_data
      )
      VALUES (
        NEW.id,
        split_part(user_name, ' ', 1),
        CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
        user_email, user_phone, oauth_provider, profile_data
      )
      ON CONFLICT (email) DO UPDATE
      SET
        user_id = NEW.id,
        oauth_provider = EXCLUDED.oauth_provider,
        oauth_profile_data = EXCLUDED.oauth_profile_data,
        updated_at = now()
      RETURNING id INTO existing_customer_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (
        NEW.id, user_email, v_step, 'success',
        'Created new customer with user_id link',
        jsonb_build_object('customer_id', existing_customer_id)
      );

      -- Step 6: Create address from Google profile if available
      IF oauth_provider = 'google' AND profile_data ? 'address' THEN
        v_step := 'create_google_address';

        DECLARE
          addr_line1 text;
          addr_city text;
          addr_state text;
          addr_zip text;
        BEGIN
          addr_line1 := profile_data->'address'->>'street_address';
          addr_city := profile_data->'address'->>'locality';
          addr_state := profile_data->'address'->>'region';
          addr_zip := profile_data->'address'->>'postal_code';

          IF addr_city IS NOT NULL AND addr_state IS NOT NULL THEN
            INSERT INTO public.addresses (
              customer_id, line1, city, state, zip
            )
            VALUES (
              existing_customer_id,
              COALESCE(addr_line1, ''),
              addr_city,
              addr_state,
              COALESCE(addr_zip, '')
            )
            RETURNING id INTO new_address_id;

            UPDATE public.customers
            SET default_address_id = new_address_id
            WHERE id = existing_customer_id;

            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
            VALUES (
              NEW.id, user_email, v_step, 'success',
              'Created address from Google profile',
              jsonb_build_object('address_id', new_address_id)
            );
          ELSE
            INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
            VALUES (NEW.id, user_email, v_step, 'skipped', 'Insufficient address data from Google');
          END IF;
        EXCEPTION WHEN OTHERS THEN
          INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message)
          VALUES (NEW.id, user_email, v_step, 'skipped', 'Could not extract address from Google profile');
        END;
      END IF;

      -- Step 7: Create contact for new customer
      v_step := 'create_new_contact';
      INSERT INTO public.contacts (
        customer_id, first_name, last_name, email, phone, source, total_bookings
      )
      VALUES (
        existing_customer_id,
        split_part(user_name, ' ', 1),
        CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
        user_email, user_phone, 'signup', 0
      )
      ON CONFLICT (email) DO UPDATE SET updated_at = now()
      RETURNING id INTO existing_contact_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (
        NEW.id, user_email, v_step, 'success',
        'Created new contact',
        jsonb_build_object('contact_id', existing_contact_id)
      );
    END IF;

    -- Step 8: Create customer profile
    v_step := 'create_customer_profile';
    INSERT INTO public.customer_profiles (user_id, contact_id, display_name, phone)
    VALUES (NEW.id, existing_contact_id, user_name, user_phone)
    ON CONFLICT (user_id) DO UPDATE
    SET contact_id = existing_contact_id, display_name = user_name,
        phone = user_phone, updated_at = now();

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (
      NEW.id, user_email, v_step, 'success',
      'Created/updated customer profile',
      jsonb_build_object('contact_id', existing_contact_id)
    );

    -- Step 9: Update contact stats if customer exists
    IF existing_customer_id IS NOT NULL THEN
      v_step := 'update_contact_stats';
      UPDATE public.contacts
      SET
        total_bookings = (
          SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id
        ),
        total_spent_cents = (
          SELECT COALESCE(SUM(
            COALESCE(subtotal_cents, 0) + COALESCE(travel_fee_cents, 0) +
            COALESCE(surface_fee_cents, 0) + COALESCE(same_day_pickup_fee_cents, 0) +
            COALESCE(generator_fee_cents, 0) + COALESCE(tax_cents, 0)
          ), 0)
          FROM public.orders
          WHERE customer_id = existing_customer_id AND status IN ('confirmed', 'completed')
        ),
        last_contact_date = now(),
        updated_at = now()
      WHERE id = existing_contact_id;

      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (
        NEW.id, user_email, v_step, 'success',
        'Updated contact statistics',
        jsonb_build_object(
          'total_bookings', (SELECT total_bookings FROM contacts WHERE id = existing_contact_id),
          'total_spent_cents', (SELECT total_spent_cents FROM contacts WHERE id = existing_contact_id)
        )
      );
    END IF;

    -- Final success log
    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (
      NEW.id, user_email, 'trigger_complete', 'success',
      'User creation and order linking completed successfully',
      jsonb_build_object(
        'customer_id', existing_customer_id,
        'contact_id', existing_contact_id,
        'address_id', new_address_id
      )
    );

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;

    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (
      NEW.id, user_email, v_step, 'error',
      v_error_message,
      jsonb_build_object('sqlstate', SQLSTATE)
    );

    RAISE WARNING 'Error in auto_assign_customer_role for user %: %', NEW.id, v_error_message;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;