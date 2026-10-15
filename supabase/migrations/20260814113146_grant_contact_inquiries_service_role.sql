/*
# Grant service-role access for contact inquiry persistence

1. Purpose
- Allow the submit-contact-inquiry Edge Function to persist and update contact inquiries using its service-role client.

2. Modified Tables
- `contact_inquiries`
- No columns or data are changed.
- Grants INSERT and SELECT for creating and reading the inserted inquiry ID.
- Grants UPDATE for marking `email_sent` after a notification succeeds.

3. Security
- Grants are limited to the `service_role` database role used by the server-side Edge Function.
- Existing RLS and administrator-only SELECT policy remain unchanged.
- No anonymous write or read access is added.
*/

/*
  Ordering note: this migration is versioned before 20260814120000_create_contact_inquiries.sql, which creates the table.
  On a database that already has the table (the hosted Development database) the grant is applied here exactly as before.
  On a clean replay the table does not exist yet, so the grant is skipped and 20260814120100_ensure_contact_inquiries_invoice_fields.sql
  applies it after the table is created. Any other failure (permissions, syntax) still raises normally.
*/
DO $$
BEGIN
  IF to_regclass('public.contact_inquiries') IS NOT NULL THEN
    GRANT INSERT, SELECT, UPDATE ON TABLE public.contact_inquiries TO service_role;
  END IF;
END
$$;
