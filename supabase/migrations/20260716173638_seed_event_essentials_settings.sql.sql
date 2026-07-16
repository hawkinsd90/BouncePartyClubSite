/*
  # Seed Event Essentials settings

  ## Purpose
  Adds two new admin_settings rows to control the Event Essentials feature:
  - event_essentials_page_enabled: gates the /event-essentials route and nav link
  - min_event_essentials_order_cents: minimum order amount for Event Essentials (display only)

  ## What this adds
  - Two new admin_settings key/value rows, seeded with safe defaults:
    - event_essentials_page_enabled = 'false' (feature hidden by default)
    - min_event_essentials_order_cents = '' (no minimum enforced)
  - Uses INSERT ... ON CONFLICT (key) DO NOTHING so re-running is safe and
    never overwrites values an admin has already configured.

  ## Security
  - No RLS policy changes. admin_settings remains admin/master-only.
  - No new tables or columns.
  - The public RPC (get_public_business_settings) is extended in a separate
    migration to expose only these two non-secret keys to anon users.
*/

INSERT INTO public.admin_settings (key, value)
VALUES
  ('event_essentials_page_enabled', 'false'),
  ('min_event_essentials_order_cents', '')
ON CONFLICT (key) DO NOTHING;
