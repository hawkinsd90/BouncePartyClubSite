/*
  # Embed actor email into user_permissions_changelog notes

  ## Summary
  Updates the log_permission_change trigger function to include the acting
  admin's email address in the notes field of each changelog entry.

  ## Why
  The changelog stores changed_by_user_id as a raw UUID. The UI renders the
  notes field but never resolves the UUID to a human-readable email. An admin
  reviewing the audit trail sees no indication of who made the change.

  The trigger is SECURITY DEFINER and can access auth.users, so the email
  can be looked up at write time with no additional RPCs or schema changes.
  The notes field already exists on the table.

  ## Changes
  - Replaces log_permission_change() trigger function body to include
    "Changed by: <email>" in the notes column for all three action types.

  ## Security
  No RLS or policy changes. The trigger runs as the definer (postgres),
  which has access to auth.users. No email is exposed to unprivileged roles.
*/

CREATE OR REPLACE FUNCTION public.log_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_email text;
BEGIN
  SELECT email INTO v_actor_email
  FROM auth.users
  WHERE id = auth.uid()
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    BEGIN
      INSERT INTO user_permissions_changelog (
        target_user_id,
        changed_by_user_id,
        action,
        new_role,
        notes
      ) VALUES (
        NEW.user_id,
        auth.uid(),
        'role_added',
        NEW.role,
        CASE WHEN v_actor_email IS NOT NULL THEN 'Changed by: ' || v_actor_email ELSE NULL END
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
        new_role,
        notes
      ) VALUES (
        NEW.user_id,
        auth.uid(),
        'role_changed',
        OLD.role,
        NEW.role,
        CASE WHEN v_actor_email IS NOT NULL THEN 'Changed by: ' || v_actor_email ELSE NULL END
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
        old_role,
        notes
      ) VALUES (
        OLD.user_id,
        auth.uid(),
        'role_removed',
        OLD.role,
        CASE WHEN v_actor_email IS NOT NULL THEN 'Changed by: ' || v_actor_email ELSE NULL END
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;
