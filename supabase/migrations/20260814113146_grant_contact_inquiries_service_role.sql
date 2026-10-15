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

GRANT INSERT, SELECT, UPDATE ON TABLE public.contact_inquiries TO service_role;