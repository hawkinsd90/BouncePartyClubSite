/*
  # Fix custom_email_hook to use built-in environment variables

  ## Problem
  The custom_email_hook was trying to look up supabase_url and supabase_service_role_key
  from admin_settings, but those keys don't exist in the table. This caused the hook
  to silently fail, meaning signup confirmation emails were never sent.

  ## Fix
  Use current_setting() to read SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
  Postgres environment variables, which are always available in Supabase.
*/

CREATE OR REPLACE FUNCTION public.custom_email_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_type  text;
  recipient   text;
  confirm_url text;
  html_body   text;
  supa_url    text;
  svc_key     text;
BEGIN
  email_type  := event->>'email_action_type';
  recipient   := event->'user'->>'email';
  confirm_url := event->'email_data'->>'confirmation_url';

  -- Read built-in Supabase env vars
  supa_url := current_setting('app.settings.supabase_url', true);
  svc_key  := current_setting('app.settings.service_role_key', true);

  -- Fallback: read from admin_settings if env vars not set
  IF supa_url IS NULL OR supa_url = '' THEN
    SELECT value INTO supa_url FROM public.admin_settings WHERE key = 'supabase_url' LIMIT 1;
  END IF;
  IF svc_key IS NULL OR svc_key = '' THEN
    SELECT value INTO svc_key FROM public.admin_settings WHERE key = 'supabase_service_role_key' LIMIT 1;
  END IF;

  IF email_type = 'signup' OR email_type = 'email_change_new' THEN
    html_body := '<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Confirm Your Bounce Party Club Account</title>
</head>
<body style="margin:0;padding:0;background:#fff8f0;font-family:''Segoe UI'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;padding:40px 0;">
<tr>
<td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr>
<td style="background:#f97316;padding:32px 40px;text-align:center;">
<img src="https://bouncepartyclub.com/bounce%20party%20club%20logo.png" alt="Bounce Party Club" style="height:72px;width:auto;display:block;margin:0 auto 12px;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Bounce Party Club</h1>
<p style="margin:6px 0 0;color:#fed7aa;font-size:14px;">Southeast Michigan''s #1 Inflatable Rental Company</p>
</td>
</tr>
<tr>
<td style="padding:40px 40px 32px;">
<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;font-weight:700;">Confirm Your Account</h2>
<p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">Thanks for signing up! Click the button below to verify your email address and get access to your Bounce Party Club account.</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
<tr>
<td style="background:#f97316;border-radius:8px;text-align:center;">
<a href="' || confirm_url || '" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">Confirm My Email</a>
</td>
</tr>
</table>
<p style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-align:center;">Or copy and paste this link into your browser:</p>
<p style="margin:0 0 32px;font-size:12px;color:#64748b;text-align:center;word-break:break-all;">' || confirm_url || '</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">
<p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">If you didn''t create an account with Bounce Party Club, you can safely ignore this email. This link expires in 24 hours.</p>
</td>
</tr>
<tr>
<td style="background:#fff8f0;padding:24px 40px;text-align:center;border-top:1px solid #fed7aa;">
<p style="margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600;">Bounce Party Club</p>
<p style="margin:0 0 4px;font-size:12px;color:#b45309;">Southeast Michigan''s Inflatable Rental Experts</p>
<p style="margin:0;font-size:12px;color:#b45309;">(313) 889-3860 &nbsp;&bull;&nbsp; bouncepartyclub.com</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>';

    IF supa_url IS NOT NULL AND supa_url <> '' AND svc_key IS NOT NULL AND svc_key <> '' THEN
      PERFORM net.http_post(
        url     := supa_url || '/functions/v1/send-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || svc_key
        ),
        body    := jsonb_build_object(
          'to',      recipient,
          'subject', 'Confirm your Bounce Party Club account',
          'html',    html_body
        )
      );
      RETURN '{}'::jsonb;
    END IF;

    -- If we still have no URL/key, return NULL so Supabase sends its default email
    RETURN NULL;
  END IF;

  -- For password reset and other types, let Supabase handle them
  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
