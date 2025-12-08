/*
  # Add Logging for User Creation Process
  
  ## Purpose
  Track the auto_assign_customer_role() trigger execution to debug
  any issues with OAuth signup or order linking.
  
  ## Changes
  1. Create auth_trigger_logs table to store execution logs
  2. Update auto_assign_customer_role() to log each step
  3. Add error handling with detailed logging
*/

-- Create logging table
CREATE TABLE IF NOT EXISTS auth_trigger_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text,
  step text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'success', 'error', 'skipped')),
  message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_trigger_logs_user_id ON auth_trigger_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_trigger_logs_created_at ON auth_trigger_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_trigger_logs_status ON auth_trigger_logs(status);

-- Enable RLS
ALTER TABLE auth_trigger_logs ENABLE ROW LEVEL SECURITY;

-- Only admins/master can view logs
CREATE POLICY "Admins can view auth logs"
  ON auth_trigger_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

-- Drop existing function
DROP FUNCTION IF EXISTS auto_assign_customer_role() CASCADE;

-- Recreate with comprehensive logging
CREATE OR REPLACE FUNCTION auto_assign_customer_role()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_customer_id uuid;
  existing_contact_id uuid;
  user_email text;
  user_name text;
  user_phone text;
  v_step text;
  v_error_message text;
BEGIN
  -- Get user info
  user_email := NEW.email;
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email);
  user_phone := NEW.phone;
  
  -- Log start
  INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
  VALUES (
    NEW.id, 
    user_email, 
    'trigger_start', 
    'started', 
    'Auto-assign customer role trigger started',
    jsonb_build_object('name', user_name, 'phone', user_phone)
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
      INSERT INTO public.customers (first_name, last_name, email, phone)
      VALUES (
        split_part(user_name, ' ', 1),
        CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
        user_email, user_phone
      )
      ON CONFLICT (email) DO UPDATE SET updated_at = now()
      RETURNING id INTO existing_customer_id;
      
      INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
      VALUES (
        NEW.id, user_email, v_step, 'success', 
        'Created new customer',
        jsonb_build_object('customer_id', existing_customer_id)
      );
      
      -- Step 6: Create contact for new customer
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
    
    -- Step 7: Create customer profile
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
    
    -- Step 8: Update contact stats if customer exists
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
        'contact_id', existing_contact_id
      )
    );
    
  EXCEPTION WHEN OTHERS THEN
    -- Log any errors
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    
    INSERT INTO auth_trigger_logs (user_id, user_email, step, status, message, metadata)
    VALUES (
      NEW.id, user_email, v_step, 'error', 
      v_error_message,
      jsonb_build_object('sqlstate', SQLSTATE)
    );
    
    -- Don't block user creation on error, just log it
    RAISE WARNING 'Error in auto_assign_customer_role for user %: %', NEW.id, v_error_message;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_customer_role();

-- Grant permissions
GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;
GRANT SELECT ON auth_trigger_logs TO authenticated;

-- Helper function to view logs for a specific user (admin only)
CREATE OR REPLACE FUNCTION get_user_creation_logs(target_email text)
RETURNS TABLE (
  step text,
  status text,
  message text,
  metadata jsonb,
  created_at timestamptz
) AS $$
BEGIN
  -- Check if caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role IN ('MASTER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can view logs';
  END IF;
  
  RETURN QUERY
  SELECT 
    l.step, 
    l.status, 
    l.message, 
    l.metadata, 
    l.created_at
  FROM auth_trigger_logs l
  WHERE l.user_email = target_email
  ORDER BY l.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_creation_logs TO authenticated;
