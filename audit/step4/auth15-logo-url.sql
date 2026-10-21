-- AUTH-15 (PREPARED, NOT EXECUTED): point Development's logo setting at the static site asset (public, verified 200 image/png, 214367 bytes).
SET LOCAL lock_timeout = '3s';
DO $bpc$
DECLARE n int;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'wrong database'; END IF;
  IF (SELECT value FROM public.admin_settings WHERE key = 'logo_url') IS DISTINCT FROM 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png' THEN RAISE EXCEPTION 'logo_url is not the expected Production-host value'; END IF;
  UPDATE public.admin_settings SET value = 'https://dev.bouncepartyclub.com/bounce%20party%20club%20logo.png' WHERE key = 'logo_url';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one row, got %', n; END IF;
END $bpc$;
-- Rollback: UPDATE public.admin_settings SET value = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png' WHERE key = 'logo_url';
