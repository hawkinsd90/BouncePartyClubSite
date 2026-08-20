/*
  # Add how_did_you_hear_enabled to public business settings RPC

  ## Purpose
  Admins need a toggle to show/hide the "How did you hear about us?" question
  on Checkout and Invoice Acceptance. Public-facing components cannot read
  admin_settings directly (RLS blocks anon/authenticated), so the existing
  SECURITY DEFINER RPC must return this safe, non-secret boolean.

  ## What this changes
  - Function: public.get_public_business_settings()
    - Adds one key to the hardcoded whitelist:
      - how_did_you_hear_enabled (string 'true'/'false')
    - No credentials or secrets are exposed.

  ## Security
  - The allowed key list remains a hardcoded whitelist inside the function.
  - SECURITY DEFINER is retained.
  - admin_settings RLS policies are NOT changed.
  - GRANT EXECUTE to anon and authenticated roles is retained.
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
    'min_event_essentials_order_cents',
    'how_did_you_hear_enabled'
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
