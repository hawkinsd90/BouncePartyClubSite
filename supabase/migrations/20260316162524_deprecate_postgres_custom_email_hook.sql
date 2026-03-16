/*
  # Deprecate public.custom_email_hook (Postgres auth email path)

  ## Summary
  The Postgres-based custom_email_hook function is no longer the active auth email path.
  The final architecture uses Supabase Auth -> Send Email Hook (HTTPS) -> auth-email-hook
  edge function, which calls Resend directly using the RESEND_API_KEY edge function secret.

  ## What this migration does
  - Drops public.custom_email_hook to eliminate the competing Postgres hook path
  - This prevents any chance of the old hook accidentally firing if someone re-enables it
    in the Supabase dashboard under Authentication > Hooks

  ## Final architecture (for reference)
  - Hook type: HTTPS (Send Email)
  - Target URL: <SUPABASE_URL>/functions/v1/auth-email-hook
  - Secret: stored as edge function secret SEND_EMAIL_HOOK_SECRET
  - Email delivery: RESEND_API_KEY edge function secret -> Resend API directly

  ## Important
  If the HTTPS hook is disabled in the Supabase dashboard, Supabase will fall back to
  its own default email. The Postgres hook path is intentionally removed.
*/

DROP FUNCTION IF EXISTS public.custom_email_hook(jsonb);
