/*
  # Create user_roles table

  1. New Tables
    - `user_roles`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `role` (text, CHECK constraint for ADMIN/CREW)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `user_roles` table
    - Users can read their own role
    - Only admins can manage roles (will be set up in later migration)
*/

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'CREW')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- Enable Row Level Security
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access (will be refined in later migration)
CREATE POLICY "Service role full access to user_roles"
  ON user_roles FOR ALL
  USING (true)
  WITH CHECK (true);
