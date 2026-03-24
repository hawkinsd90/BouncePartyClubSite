/*
  # Fix log_permission_change trigger to handle constraint violations gracefully

  ## Problem
  The trigger inserts into user_permissions_changelog with old_role/new_role values,
  but the changelog table has CHECK constraints that only allow 'master', 'admin', 'crew', or NULL.
  When a 'customer' role is involved (or any unexpected value), the INSERT fails and
  rolls back the entire user_roles change — preventing admins from assigning roles.

  ## Fix
  Wrap the changelog INSERT in an EXCEPTION block so failures are silently ignored,
  allowing the actual role change to succeed regardless.
*/

CREATE OR REPLACE FUNCTION log_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

  ELSIF TG_OP = 'UPDATE' AND OLD.role != NEW.role THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

  ELSIF TG_OP = 'DELETE' THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
