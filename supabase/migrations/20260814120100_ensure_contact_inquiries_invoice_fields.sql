/*
# Ensure contact_inquiries has its invoice-ready columns and service-role grant

1. Purpose
- 20260814113146 (service-role grant) and 20260814114825 (invoice-ready columns) are versioned before
  20260814120000 (table creation), so on a clean replay they find no table. They now skip in that case.
- This migration runs after the table exists and guarantees the same end state on every database:
  the ten invoice-ready columns and the service-role grant that submit-contact-inquiry needs.

2. Safety
- Purely additive and idempotent: ADD COLUMN IF NOT EXISTS and GRANT are no-ops where already present
  (the hosted Development database already has all of it).
- No table is dropped or recreated, no data is touched, RLS and policies are unchanged.
- No anonymous or authenticated privileges are granted.
*/

ALTER TABLE public.contact_inquiries
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS event_address text,
  ADD COLUMN IF NOT EXISTS event_city text,
  ADD COLUMN IF NOT EXISTS event_state text,
  ADD COLUMN IF NOT EXISTS event_zip text,
  ADD COLUMN IF NOT EXISTS event_start_time text,
  ADD COLUMN IF NOT EXISTS event_end_time text,
  ADD COLUMN IF NOT EXISTS surface_type text,
  ADD COLUMN IF NOT EXISTS referral_source text;

GRANT INSERT, SELECT, UPDATE ON TABLE public.contact_inquiries TO service_role;
