/*
  # Add get_public_business_settings RPC

  ## Purpose
  Public-facing components (Layout, PaymentSuccessState, PrintableInvoice) need to display
  business identity information (phone, email, social links, address) to anonymous and
  non-admin users. The admin_settings table is correctly locked behind admin-only RLS, so
  direct client reads fail for public users.

  This RPC uses SECURITY DEFINER to read only the safe, non-secret subset of admin_settings
  and return it to any caller (anon or authenticated), without ever exposing credential keys.

  ## What this adds
  - Function: `public.get_public_business_settings()`
    - Returns a JSON object with only these safe keys:
      business_name, business_phone, business_email, logo_url,
      instagram_url, facebook_url, business_address,
      home_address_line1, home_address_line2, home_address_city,
      home_address_state, home_address_zip
    - SECURITY DEFINER: runs as the function owner (postgres), bypassing caller RLS
    - Explicitly does NOT expose: stripe keys, twilio tokens, resend key,
      google oauth secret, admin_notification_phone, admin_email, or any other credential

  ## Security notes
  - The allowed key list is a hardcoded whitelist inside the function body
  - No credential or operational-secret key is in the whitelist
  - admin_settings RLS policies are NOT changed — they remain admin/master-only
  - GRANT EXECUTE to anon and authenticated roles only (not postgres/service_role needed separately)
  - REVOKE EXECUTE from PUBLIC to prevent implicit public access before explicit grants
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
    'home_address_zip'
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
