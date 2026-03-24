/*
  # Normalize any remaining uppercase role values

  ## Problem
  One row (hwkvzn@gmail.com) still has role = 'MASTER' because it was written
  by the old PermissionsTab code that called newRole.toUpperCase() before the fix.
  All RLS policies and frontend logic now expect lowercase values.

  ## Fix
  Lowercase any remaining uppercase role values in user_roles.
*/

UPDATE user_roles
SET role = LOWER(role)
WHERE role != LOWER(role);
