/*
  # Fix user_permissions_changelog role check constraints

  ## Problem
  The old_role and new_role check constraints only allowed 'master', 'admin', 'crew', or NULL.
  This caused failures when logging transitions involving 'customer' roles.

  ## Fix
  Update the constraints to also allow 'customer' as a valid role value.
*/

ALTER TABLE user_permissions_changelog
  DROP CONSTRAINT IF EXISTS user_permissions_changelog_new_role_check;

ALTER TABLE user_permissions_changelog
  DROP CONSTRAINT IF EXISTS user_permissions_changelog_old_role_check;

ALTER TABLE user_permissions_changelog
  ADD CONSTRAINT user_permissions_changelog_new_role_check
    CHECK (new_role = ANY (ARRAY['master'::text, 'admin'::text, 'crew'::text, 'customer'::text, NULL::text]));

ALTER TABLE user_permissions_changelog
  ADD CONSTRAINT user_permissions_changelog_old_role_check
    CHECK (old_role = ANY (ARRAY['master'::text, 'admin'::text, 'crew'::text, 'customer'::text, NULL::text]));
