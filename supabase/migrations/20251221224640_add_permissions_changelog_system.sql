/*
  # Add Permissions Changelog System

  1. New Tables
    - `user_permissions_changelog`
      - `id` (uuid, primary key)
      - `target_user_id` (uuid) - User whose permissions changed
      - `changed_by_user_id` (uuid) - User who made the change
      - `action` (text) - Type of change (role_added, role_removed, role_changed)
      - `old_role` (text) - Previous role (if applicable)
      - `new_role` (text) - New role
      - `notes` (text) - Optional notes about the change
      - `created_at` (timestamptz) - When change occurred

  2. Security
    - RLS enabled on user_permissions_changelog
    - Admin and master can view all changelog entries
    - Regular users can view their own changelog entries

  3. Features
    - Tracks all permission changes
    - Provides audit trail for security
    - Enables email notifications on permission changes
*/

-- Create user permissions changelog table
CREATE TABLE IF NOT EXISTS user_permissions_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('role_added', 'role_removed', 'role_changed', 'account_created', 'account_deleted')),
  old_role text CHECK (old_role IN ('master', 'admin', 'crew', NULL)),
  new_role text CHECK (new_role IN ('master', 'admin', 'crew', NULL)),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_permissions_changelog ENABLE ROW LEVEL SECURITY;

-- Admin and master can view all changelog entries
CREATE POLICY "Admins can view all permission changes"
  ON user_permissions_changelog FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Users can view their own permission changes
CREATE POLICY "Users can view own permission changes"
  ON user_permissions_changelog FOR SELECT
  TO authenticated
  USING (target_user_id = auth.uid());

-- Only admins and masters can insert changelog entries
CREATE POLICY "Admins can create permission changelog"
  ON user_permissions_changelog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_permissions_changelog_target_user 
  ON user_permissions_changelog(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_permissions_changelog_changed_by 
  ON user_permissions_changelog(changed_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_permissions_changelog_created_at 
  ON user_permissions_changelog(created_at DESC);

-- Function to log permission changes automatically
CREATE OR REPLACE FUNCTION log_permission_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- On INSERT (new role added)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_permissions_changelog (
      target_user_id,
      changed_by_user_id,
      action,
      new_role
    ) VALUES (
      NEW.user_id,
      auth.uid(),
      'role_added',
      NEW.role
    );
  
  -- On UPDATE (role changed)
  ELSIF TG_OP = 'UPDATE' AND OLD.role != NEW.role THEN
    INSERT INTO user_permissions_changelog (
      target_user_id,
      changed_by_user_id,
      action,
      old_role,
      new_role
    ) VALUES (
      NEW.user_id,
      auth.uid(),
      'role_changed',
      OLD.role,
      NEW.role
    );
  
  -- On DELETE (role removed)
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO user_permissions_changelog (
      target_user_id,
      changed_by_user_id,
      action,
      old_role
    ) VALUES (
      OLD.user_id,
      auth.uid(),
      'role_removed',
      OLD.role
    );
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on user_roles table to auto-log changes
DROP TRIGGER IF EXISTS trigger_log_permission_change ON user_roles;

CREATE TRIGGER trigger_log_permission_change
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION log_permission_change();
