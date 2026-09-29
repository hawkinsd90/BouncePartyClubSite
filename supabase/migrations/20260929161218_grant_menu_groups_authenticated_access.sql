/*
# Grant authenticated access to Menu Groups tables

1. Purpose
- Restore the table-level privileges required by the Admin Menu Groups screen.
- Keep public users restricted to the sanitized navigation RPC.

2. Modified Tables
- `public_menu_groups`: grant authenticated SELECT, INSERT, UPDATE, and DELETE.
- `public_menu_group_categories`: grant authenticated SELECT, INSERT, UPDATE, and DELETE.

3. Security
- Row Level Security remains enabled on both tables.
- Existing ADMIN / MASTER policies continue to control which authenticated users
  can actually read or change rows.
- No privileges are granted to `anon`; public navigation remains RPC-only.
*/

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_menu_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_menu_group_categories TO authenticated;
