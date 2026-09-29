/*
# Fix Menu Groups admin visibility

1. Problem
- Menu Groups rows were successfully created, but authenticated admin users could not see them afterward.
- The stored roles use lowercase values such as `master`, while the Menu Groups RLS policies compared against uppercase values.

2. Modified Tables
- `public_menu_groups`: replace the ADMIN / MASTER SELECT, INSERT, UPDATE, and DELETE policy predicates.
- `public_menu_group_categories`: replace the ADMIN / MASTER SELECT, INSERT, and DELETE policy predicates.

3. Security
- Policies remain restricted to the `authenticated` role.
- Access still requires a matching `user_roles` row for `admin` or `master`.
- No anonymous table access is added.
*/

DROP POLICY IF EXISTS "Admins can read all menu groups" ON public.public_menu_groups;
CREATE POLICY "Admins can read all menu groups"
ON public.public_menu_groups FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can insert menu groups" ON public.public_menu_groups;
CREATE POLICY "Admins can insert menu groups"
ON public.public_menu_groups FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can update menu groups" ON public.public_menu_groups;
CREATE POLICY "Admins can update menu groups"
ON public.public_menu_groups FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can delete menu groups" ON public.public_menu_groups;
CREATE POLICY "Admins can delete menu groups"
ON public.public_menu_groups FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can read all menu group categories" ON public.public_menu_group_categories;
CREATE POLICY "Admins can read all menu group categories"
ON public.public_menu_group_categories FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can insert menu group categories" ON public.public_menu_group_categories;
CREATE POLICY "Admins can insert menu group categories"
ON public.public_menu_group_categories FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);

DROP POLICY IF EXISTS "Admins can delete menu group categories" ON public.public_menu_group_categories;
CREATE POLICY "Admins can delete menu group categories"
ON public.public_menu_group_categories FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND lower(user_roles.role) IN ('admin', 'master')
  )
);
