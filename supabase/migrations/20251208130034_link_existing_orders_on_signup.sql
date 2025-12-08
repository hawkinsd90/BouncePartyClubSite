/*
  # Link Existing Orders to New User Accounts
  
  ## Problem
  When customers create an account, any orders they previously placed
  (before signing up) should automatically be linked to their new account.
  
  ## Solution
  Update the auto_assign_customer_role() trigger to:
  1. Find existing customers/contacts matching the user's email
  2. Link the customer_profile to existing contact records
  3. Create contact record if it doesn't exist
  
  ## Changes
  - Enhanced auto_assign_customer_role() function to link existing data
*/

-- Drop existing function
DROP FUNCTION IF EXISTS auto_assign_customer_role() CASCADE;

-- Recreate with order linking logic
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
BEGIN
  -- Get user info
  user_email := NEW.email;
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email);
  user_phone := NEW.phone;
  
  -- Only auto-assign if user has no roles yet
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    -- Insert CUSTOMER role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'CUSTOMER')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    -- Try to find existing contact by email
    SELECT id, customer_id INTO existing_contact_id, existing_customer_id
    FROM public.contacts
    WHERE email = user_email
    LIMIT 1;
    
    -- If no contact exists, try to find customer by email
    IF existing_contact_id IS NULL THEN
      SELECT id INTO existing_customer_id
      FROM public.customers
      WHERE email = user_email
      LIMIT 1;
      
      -- If customer exists but no contact, create contact
      IF existing_customer_id IS NOT NULL THEN
        INSERT INTO public.contacts (
          customer_id,
          first_name,
          last_name,
          email,
          phone,
          source,
          total_bookings
        )
        VALUES (
          existing_customer_id,
          split_part(user_name, ' ', 1),
          CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
          user_email,
          user_phone,
          'signup',
          (SELECT COUNT(*) FROM public.orders WHERE customer_id = existing_customer_id)
        )
        ON CONFLICT (email) DO UPDATE
        SET updated_at = now()
        RETURNING id INTO existing_contact_id;
      END IF;
    END IF;
    
    -- If still no contact/customer exists, create both
    IF existing_contact_id IS NULL AND existing_customer_id IS NULL THEN
      -- Create customer first
      INSERT INTO public.customers (first_name, last_name, email, phone)
      VALUES (
        split_part(user_name, ' ', 1),
        CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
        user_email,
        user_phone
      )
      ON CONFLICT (email) DO UPDATE
      SET updated_at = now()
      RETURNING id INTO existing_customer_id;
      
      -- Then create contact
      INSERT INTO public.contacts (
        customer_id,
        first_name,
        last_name,
        email,
        phone,
        source,
        total_bookings
      )
      VALUES (
        existing_customer_id,
        split_part(user_name, ' ', 1),
        CASE WHEN position(' ' in user_name) > 0 THEN split_part(user_name, ' ', 2) ELSE '' END,
        user_email,
        user_phone,
        'signup',
        0
      )
      ON CONFLICT (email) DO UPDATE
      SET updated_at = now()
      RETURNING id INTO existing_contact_id;
    END IF;
    
    -- Create customer profile linked to the contact
    INSERT INTO public.customer_profiles (user_id, contact_id, display_name, phone)
    VALUES (
      NEW.id,
      existing_contact_id,
      user_name,
      user_phone
    )
    ON CONFLICT (user_id) DO UPDATE
    SET contact_id = existing_contact_id,
        display_name = user_name,
        phone = user_phone,
        updated_at = now();
        
    -- Update contact with total bookings if customer exists
    IF existing_customer_id IS NOT NULL THEN
      UPDATE public.contacts
      SET total_bookings = (
        SELECT COUNT(*) 
        FROM public.orders 
        WHERE customer_id = existing_customer_id
      ),
      total_spent_cents = (
        SELECT COALESCE(SUM(
          COALESCE(subtotal_cents, 0) + 
          COALESCE(travel_fee_cents, 0) + 
          COALESCE(surface_fee_cents, 0) + 
          COALESCE(same_day_pickup_fee_cents, 0) + 
          COALESCE(generator_fee_cents, 0) + 
          COALESCE(tax_cents, 0)
        ), 0)
        FROM public.orders 
        WHERE customer_id = existing_customer_id
        AND status IN ('confirmed', 'completed')
      ),
      last_contact_date = now(),
      updated_at = now()
      WHERE id = existing_contact_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_customer_role();

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;
