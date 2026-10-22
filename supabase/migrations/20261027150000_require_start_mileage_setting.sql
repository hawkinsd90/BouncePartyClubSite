/*
  # Public settings: start-mileage requirement (and the two evidence-photo requirements)

  ## Purpose
  The Crew task screens ("En Route", "Arrived", "Complete delivery", "Complete pickup") require a start-of-day mileage
  reading. The owner needs to switch that requirement off. Crew cannot read admin_settings (it holds credentials), so the
  setting is exposed through the existing whitelist function get_public_business_settings(), which every signed-in
  role can call.

  ## What this changes
  - Seeds three non-secret settings (only when they do not exist yet):
      require_start_mileage    'true'
      require_delivery_photo   'true'   (used by a later change; seeded now so this function is replaced once)
      require_pickup_photo     'true'   (used by a later change)
  - Replaces public.get_public_business_settings(): the 15 keys it already returns, unchanged, plus the three above.

  ## Security
  - The allow-list stays a hard-coded list inside the function; no secret-looking key is added.
  - SECURITY DEFINER with search_path = public is retained. Execute stays revoked from PUBLIC and granted to
    anon, authenticated and service_role (the grants the function has today, plus service_role).
  - admin_settings policies are NOT changed: crew still reads no admin_settings rows directly.
  - Idempotent: safe to run twice. A missing or unreadable value is treated as "required" by the application (fail closed).
*/

INSERT INTO public.admin_settings (key, value)
VALUES
  ('require_start_mileage', 'true'),
  ('require_delivery_photo', 'true'),
  ('require_pickup_photo', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_public_business_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
  allowed_keys text[] := ARRAY[
    'business_name',
    'business_phone',
    'business_email',
    'logo_url',
    'instagram_url',
    'facebook_url',
    'business_address',
    'home_address_line1',
    'home_address_line2',
    'home_address_city',
    'home_address_state',
    'home_address_zip',
    'event_essentials_page_enabled',
    'min_event_essentials_order_cents',
    'how_did_you_hear_enabled',
    'require_start_mileage',
    'require_delivery_photo',
    'require_pickup_photo'
  ];
  rec record;
BEGIN
  FOR rec IN
    SELECT key, value
    FROM public.admin_settings
    WHERE key = ANY(allowed_keys)
  LOOP
    result := result || jsonb_build_object(rec.key, rec.value);
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_business_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO service_role;
