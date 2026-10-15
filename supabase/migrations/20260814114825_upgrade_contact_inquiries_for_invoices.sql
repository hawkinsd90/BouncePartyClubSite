/*
# Upgrade contact_inquiries with invoice-ready fields

1. Purpose
- Contact submissions must capture enough detail for staff to create an admin invoice
  or send a follow-up email without a second round of questions.

2. New Columns on `contact_inquiries`
- `first_name` text — customer first name (optional, kept separate from legacy `name`)
- `last_name` text — customer last name (optional)
- `event_address` text — street address where the event will take place (optional)
- `event_city` text — city for the event address (optional)
- `event_state` text — state for the event address (optional)
- `event_zip` text — zip code for the event address (optional)
- `event_start_time` text — start time in HH:mm format (optional)
- `event_end_time` text — end time in HH:mm format (optional)
- `surface_type` text — e.g. grass, concrete, dirt, mixed (optional)
- `referral_source` text — how they heard about us (optional)

3. Security
- No RLS or policy changes.
- Existing admin/master SELECT policy remains the only read path.
- All writes still go through the service-role Edge Function.
- Grants INSERT, SELECT, UPDATE to service_role (already present, re-granted for idempotency).
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