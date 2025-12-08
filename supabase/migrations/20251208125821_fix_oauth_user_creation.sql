/*
  # Fix OAuth User Creation Issue
  
  ## Problem
  When users sign up via Google OAuth, the auto_assign_customer_role() trigger
  fails due to RLS restrictions on the user_roles table.
  
  ## Solution
  Recreate the auto_assign_customer_role() function to properly bypass RLS
  by setting the session role within the SECURITY DEFINER function.
  
  ## Changes
  1. Drop and recreate auto_assign_customer_role() function with proper RLS bypass
  2. Ensure the function can insert into user_roles and customer_profiles tables
*/

-- Drop existing function
DROP FUNCTION IF EXISTS auto_assign_customer_role() CASCADE;

-- Recreate with proper RLS handling
CREATE OR REPLACE FUNCTION auto_assign_customer_role()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Only auto-assign if user has no roles yet
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    -- Insert role (bypasses RLS because function is SECURITY DEFINER)
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'CUSTOMER')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    -- Create customer profile (bypasses RLS because function is SECURITY DEFINER)
    INSERT INTO public.customer_profiles (user_id, display_name, phone)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email),
      NEW.phone
    )
    ON CONFLICT (user_id) DO NOTHING;
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

-- Grant execute permission to the postgres role
GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;
