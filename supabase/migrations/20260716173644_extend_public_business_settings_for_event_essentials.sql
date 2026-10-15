/*
  # Extend get_public_business_settings for Event Essentials

  ## Purpose
  The Event Essentials catalog page and nav link need to be gated by a public
  feature flag, and the minimum order amount needs to be displayed to anonymous
  customers. Anonymous users cannot read admin_settings directly (RLS blocks
  them), so the existing SECURITY DEFINER RPC must return these two safe,
  non-secret values.

  ## What this changes
  - Function: public.get_public_business_settings()
    - Adds two keys to the hardcoded whitelist:
      - event_essentials_page_enabled (string 'true'/'false')
      - min_event_essentials_order_cents (string, may be empty)
    - No other keys are exposed. No credentials, secrets, or operational
      settings are added.

  ## Security
  - The allowed key list remains a hardcoded whitelist inside the function.
  - SECURITY DEFINER is retained; the function runs as owner, bypassing caller RLS.
  - No credential or operational-secret key is in the whitelist.
  - admin_settings RLS policies are NOT changed.
  - GRANT EXECUTE to anon and authenticated roles is retained.
  - DROP/RECREATE is used to update the function definition idempotently.
*/

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
    'min_event_essentials_order_cents'
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

REVOKE EXECUTE ON FUNCTION public.get_public_business_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_business_settings() TO authenticated;
