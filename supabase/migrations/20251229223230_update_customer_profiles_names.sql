/*
  # Update Customer Profiles to Use Separate Name Fields

  ## Changes
  1. Add first_name and last_name columns to customer_profiles
  2. Migrate existing display_name data to first_name/last_name
  3. Drop display_name column
  4. Update auto_assign_customer_role() trigger to use new fields

  ## Migration Strategy
  - For existing profiles, split display_name on first space into first/last
  - For OAuth users, extract from raw_user_meta_data
  - Preserve all existing data safely
*/

-- Step 1: Add new columns
ALTER TABLE customer_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

-- Step 2: Migrate existing display_name data to first_name/last_name
UPDATE customer_profiles
SET
  first_name = CASE
    WHEN display_name IS NOT NULL AND position(' ' in display_name) > 0
    THEN split_part(display_name, ' ', 1)
    WHEN display_name IS NOT NULL
    THEN display_name
    ELSE NULL
  END,
  last_name = CASE
    WHEN display_name IS NOT NULL AND position(' ' in display_name) > 0
    THEN substring(display_name from position(' ' in display_name) + 1)
    ELSE NULL
  END
WHERE display_name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Step 3: Drop display_name column (after migration)
ALTER TABLE customer_profiles DROP COLUMN IF EXISTS display_name;

-- Step 4: Update the auto_assign_customer_role() function
DROP FUNCTION IF EXISTS auto_assign_customer_role() CASCADE;

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

    -- Create customer profile with separate first/last name fields
    INSERT INTO public.customer_profiles (
      user_id,
      first_name,
      last_name,
      phone
    )
    VALUES (
      NEW.id,
      -- Extract first name from metadata or email
      COALESCE(
        NEW.raw_user_meta_data->>'first_name',
        split_part(COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', NEW.email), ' ', 1)
      ),
      -- Extract last name from metadata if available
      COALESCE(
        NEW.raw_user_meta_data->>'last_name',
        NULLIF(substring(
          COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', '')
          from position(' ' in COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', '')) + 1
        ), '')
      ),
      -- Phone from metadata or auth.users phone
      COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone)
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION auto_assign_customer_role() TO postgres, service_role;