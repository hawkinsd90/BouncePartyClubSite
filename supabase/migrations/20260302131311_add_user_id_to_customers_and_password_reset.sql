/*
  # Add user authentication link and enable password reset

  1. Schema Changes
    - Add `user_id` column to `customers` table
    - Link customers to auth.users for profile management
    - Create unique index on user_id for fast lookups
    
  2. Security
    - Add RLS policy for users to read their own customer profile
    - Add RLS policy for users to update their own customer profile
    
  3. Data Migration
    - Link existing customers to users based on email match
*/

-- Add user_id column to customers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create unique index on user_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'customers_user_id_idx'
  ) THEN
    CREATE UNIQUE INDEX customers_user_id_idx ON customers(user_id) WHERE user_id IS NOT NULL;
  END IF;
END $$;

-- Link existing customers to users by email
UPDATE customers c
SET user_id = u.id
FROM auth.users u
WHERE c.email = u.email
AND c.user_id IS NULL;

-- Add RLS policies for customer self-management
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'customers' 
    AND policyname = 'Users can view their own customer profile'
  ) THEN
    CREATE POLICY "Users can view their own customer profile"
      ON customers
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'customers' 
    AND policyname = 'Users can update their own customer profile'
  ) THEN
    CREATE POLICY "Users can update their own customer profile"
      ON customers
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;