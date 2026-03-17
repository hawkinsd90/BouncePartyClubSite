/*
  # Drop public.custom_email_hook (Postgres auth email path)

  ## Summary
  The Postgres-based custom_email_hook function is not part of the active auth email path.
  This migration drops it to prevent it from being accidentally re-enabled.

  ## What this migration does
  - Drops public.custom_email_hook if it exists
  - This prevents any chance of the old hook accidentally firing if someone re-enables it
    in the Supabase dashboard under Authentication > Hooks

  ## Final architecture (for reference)
  - Auth emails: Supabase Auth built-in email sending (no Send Email hook active)
  - Authentication > Hooks > Send Email: DISABLED
  - Email templates: customized directly in Supabase Dashboard > Authentication > Email Templates
  - auth-email-hook edge function: DEPRECATED stub only (returns HTTP 410)
  - Business/app emails: send-email edge function via Resend (unchanged)

  ## Note
  The HTTPS Send Email hook (auth-email-hook) described in earlier migrations is also
  deprecated. No hook of any kind should be active in Authentication > Hooks.
*/

DROP FUNCTION IF EXISTS public.custom_email_hook(jsonb);
