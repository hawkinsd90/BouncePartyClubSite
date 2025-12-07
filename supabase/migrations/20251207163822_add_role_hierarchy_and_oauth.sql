/*
  # Add Role Hierarchy and Customer Support

  ## Overview
  This migration upgrades the authentication system to support a four-tier role hierarchy
  and prepares the system for customer self-service and OAuth authentication.

  ## Changes

  1. **Role System Updates**
     - Add MASTER role (highest permission level)
     - Add CUSTOMER role (default for new signups)
     - Existing roles: ADMIN, CREW
     - Upgrade admin@bouncepartyclub.com to MASTER role

  2. **Customer Profiles Table**
     - Links auth.users to their contact and order information
     - Stores customer preferences and settings
     - Enables customer portal features

  3. **Role Management Functions**
     - Helper function to check user roles
     - Function to assign roles with permission checks
     - Function to remove roles with permission checks

  4. **Security Policies**
     - MASTER can manage all roles
     - ADMIN can manage CREW and CUSTOMER roles only
     - Users can view their own role information
     - Customers can view their own orders

  ## Permission Matrix
  
  | Action              | MASTER | ADMIN | CREW | CUSTOMER |
  |---------------------|--------|-------|------|----------|
  | Manage MASTER       | ✓      | ✗     | ✗    | ✗        |
  | Manage ADMIN        | ✓      | ✗     | ✗    | ✗        |
  | Manage CREW         | ✓      | ✓     | ✗    | ✗        |
  | Manage CUSTOMER     | ✓      | ✓     | ✗    | ✗        |
  | View All Orders     | ✓      | ✓     | ✗    | ✗        |
  | View Assigned Tasks | ✓      | ✓     | ✓    | ✗        |
  | View Own Orders     | ✓      | ✓     | ✓    | ✓        |
  | Create Bookings     | ✓      | ✓     | ✓    | ✓        |
*/

-- Step 1: Drop existing CHECK constraint on user_roles
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;

-- Step 2: Add new CHECK constraint with all four roles
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check 
  CHECK (role IN ('MASTER', 'ADMIN', 'CREW', 'CUSTOMER'));

-- Step 3: Create customer_profiles table to link customers to their data
CREATE TABLE IF NOT EXISTS customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  display_name text,
  phone text,
  email_notifications boolean DEFAULT true,
  sms_notifications boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_user_id ON customer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_contact_id ON customer_profiles(contact_id);

-- Enable RLS on customer_profiles
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

-- Customers can view and update their own profile
CREATE POLICY "Users can view own profile"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON customer_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all customer profiles
CREATE POLICY "Admins can view all profiles"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('MASTER', 'ADMIN')
    )
  );

-- Step 4: Create helper function to check if user has a specific role
CREATE OR REPLACE FUNCTION user_has_role(check_user_id uuid, check_role text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id AND role = check_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create function to get user's highest role
CREATE OR REPLACE FUNCTION get_user_highest_role(check_user_id uuid)
RETURNS text AS $$
DECLARE
  highest_role text;
BEGIN
  SELECT role INTO highest_role
  FROM user_roles
  WHERE user_id = check_user_id
  ORDER BY 
    CASE role
      WHEN 'MASTER' THEN 1
      WHEN 'ADMIN' THEN 2
      WHEN 'CREW' THEN 3
      WHEN 'CUSTOMER' THEN 4
      ELSE 5
    END
  LIMIT 1;
  
  RETURN COALESCE(highest_role, 'CUSTOMER');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Create function to assign role with permission check
CREATE OR REPLACE FUNCTION assign_user_role(
  target_user_id uuid,
  target_role text
)
RETURNS boolean AS $$
DECLARE
  current_user_role text;
BEGIN
  -- Get the current user's highest role
  current_user_role := get_user_highest_role(auth.uid());
  
  -- MASTER can assign any role
  IF current_user_role = 'MASTER' THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (target_user_id, target_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN true;
  END IF;
  
  -- ADMIN can only assign CREW or CUSTOMER roles
  IF current_user_role = 'ADMIN' AND target_role IN ('CREW', 'CUSTOMER') THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (target_user_id, target_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN true;
  END IF;
  
  -- Unauthorized
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Create function to remove role with permission check
CREATE OR REPLACE FUNCTION remove_user_role(
  target_user_id uuid,
  target_role text
)
RETURNS boolean AS $$
DECLARE
  current_user_role text;
BEGIN
  -- Get the current user's highest role
  current_user_role := get_user_highest_role(auth.uid());
  
  -- MASTER can remove any role
  IF current_user_role = 'MASTER' THEN
    DELETE FROM user_roles
    WHERE user_id = target_user_id AND role = target_role;
    RETURN true;
  END IF;
  
  -- ADMIN can only remove CREW or CUSTOMER roles
  IF current_user_role = 'ADMIN' AND target_role IN ('CREW', 'CUSTOMER') THEN
    DELETE FROM user_roles
    WHERE user_id = target_user_id AND role = target_role;
    RETURN true;
  END IF;
  
  -- Unauthorized
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Update admin@bouncepartyclub.com to MASTER role
DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  -- Find the admin user
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = 'admin@bouncepartyclub.com'
  LIMIT 1;
  
  -- If user exists, upgrade to MASTER
  IF admin_user_id IS NOT NULL THEN
    -- Remove old ADMIN role
    DELETE FROM user_roles
    WHERE user_id = admin_user_id AND role = 'ADMIN';
    
    -- Add MASTER role
    INSERT INTO user_roles (user_id, role)
    VALUES (admin_user_id, 'MASTER')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    -- Update user metadata
    UPDATE auth.users
    SET 
      raw_app_meta_data = jsonb_set(
        COALESCE(raw_app_meta_data, '{}'::jsonb),
        '{role}',
        '"MASTER"'
      ),
      raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{role}',
        '"MASTER"'
      ),
      updated_at = now()
    WHERE id = admin_user_id;
  END IF;
END $$;

-- Step 9: Add customer-friendly policies to orders table
-- Customers can view their own orders (matched by email or through contact_id)
DROP POLICY IF EXISTS "Customers can view own orders" ON orders;
CREATE POLICY "Customers can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customer_profiles cp
      JOIN contacts c ON c.id = cp.contact_id
      WHERE cp.user_id = auth.uid()
      AND orders.customer_id = c.customer_id
    )
    OR
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND orders.customer_id = c.customer_id
    )
  );

-- Step 10: Create trigger to auto-assign CUSTOMER role on signup
CREATE OR REPLACE FUNCTION auto_assign_customer_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Only auto-assign if user has no roles yet
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO user_roles (user_id, role)
    VALUES (NEW.id, 'CUSTOMER')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    -- Create customer profile
    INSERT INTO customer_profiles (user_id, display_name, phone)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
      NEW.phone
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_customer_role();

-- Step 11: Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON customer_profiles TO authenticated;
GRANT UPDATE ON customer_profiles TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_role TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_highest_role TO authenticated;
GRANT EXECUTE ON FUNCTION assign_user_role TO authenticated;
GRANT EXECUTE ON FUNCTION remove_user_role TO authenticated;
