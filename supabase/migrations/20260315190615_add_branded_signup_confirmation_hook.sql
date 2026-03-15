/*
  # Add branded signup email hook

  ## Purpose
  Replace Supabase's generic "Confirm your signup" email with a branded
  Bounce Party Club version via a custom email send hook.

  ## What this does
  - Creates a pg_net-based function that is called when Supabase needs to
    send an email (via the send_email hook)
  - Sends a branded HTML confirmation email through the existing send-email
    edge function
  - Falls back gracefully if the hook fails (Supabase still sends its own)

  ## Note
  The hook function is created but must be enabled in the Supabase dashboard
  under Authentication > Hooks > Send Email (or via supabase CLI).
  This migration creates the function so it is ready to be activated.
*/

CREATE OR REPLACE FUNCTION public.custom_email_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  email_type text;
  recipient  text;
  confirm_url text;
  html_body  text;
  response   jsonb;
BEGIN
  email_type  := event->>'email_action_type';
  recipient   := event->'user'->>'email';
  confirm_url := event->'email_data'->>'confirmation_url';

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
          <!-- Header -->
          <tr>
            <td style="background:#f97316;padding:32px 40px;text-align:center;">
              <img src="https://bouncepartyclub.com/bounce%20party%20club%20logo.png"
                   alt="Bounce Party Club"
                   style="height:72px;width:auto;display:block;margin:0 auto 12px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                Bounce Party Club
              </h1>
              <p style="margin:6px 0 0;color:#fed7aa;font-size:14px;">
                Southeast Michigan''s #1 Inflatable Rental Company
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;font-weight:700;">
                Confirm Your Account
              </h2>
              <p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">
                Thanks for signing up! Click the button below to verify your email address and
                get access to your Bounce Party Club account.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#f97316;border-radius:8px;text-align:center;">
                    <a href="' || confirm_url || '"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      Confirm My Email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-align:center;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 32px;font-size:12px;color:#64748b;text-align:center;word-break:break-all;">
                ' || confirm_url || '
              </p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">
              <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
                If you didn''t create an account with Bounce Party Club, you can safely ignore
                this email. This link expires in 24 hours.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fff8f0;padding:24px 40px;text-align:center;border-top:1px solid #fed7aa;">
              <p style="margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600;">
                Bounce Party Club
              </p>
              <p style="margin:0 0 4px;font-size:12px;color:#b45309;">
                Southeast Michigan''s Inflatable Rental Experts
              </p>
              <p style="margin:0;font-size:12px;color:#b45309;">
                (313) 889-3860 &nbsp;&bull;&nbsp; bouncepartyclub.com
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>';

    PERFORM net.http_post(
      url     := (SELECT value FROM public.admin_settings WHERE key = 'supabase_url' LIMIT 1)
                 || '/functions/v1/send-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM public.admin_settings WHERE key = 'supabase_service_role_key' LIMIT 1)
      ),
      body    := jsonb_build_object(
        'to',      recipient,
        'subject', 'Confirm your Bounce Party Club account',
        'html',    html_body
      )
    );

    -- Return empty object to suppress Supabase''s default email
    RETURN '{}'::jsonb;
  END IF;

  -- For other email types (password reset, etc.) let Supabase handle them
  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  -- On any error, return NULL so Supabase falls back to its own email
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_email_hook(jsonb) TO supabase_auth_admin;
