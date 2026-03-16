/*
  # Deprecate custom auth email hook architecture

  ## Summary
  Finalizes the removal of all custom auth email hook infrastructure.
  Supabase Auth default email sending is now the sole path for auth emails.

  ## What changed
  - The public.custom_email_hook Postgres function was already dropped in migration
    20260316162524_deprecate_postgres_custom_email_hook.sql
  - The auth-email-hook edge function is now a deprecated stub (returns HTTP 410)
  - No Send Email hook should be active in Authentication > Hooks

  ## Final auth email architecture
  - Supabase Auth built-in email sending: ACTIVE
  - Authentication > Hooks > Send Email: DISABLED (no hook)
  - auth-email-hook edge function: DEPRECATED (stub only)
  - public.custom_email_hook Postgres function: DROPPED (does not exist)

  ## Business email architecture (UNCHANGED)
  - send-email edge function: ACTIVE for all order/invoice/admin emails
  - RESEND_API_KEY in admin_settings: still used by send-email for business emails

  ## Secrets status after this change
  - RESEND_API_KEY (edge function secret): still needed for send-email business emails
  - SEND_EMAIL_HOOK_SECRET (edge function secret): no longer needed for any active path
    (safe to delete from Supabase Dashboard > Edge Functions > Secrets)

  ## Action required in Supabase Dashboard
  1. Authentication > Hooks > Send Email: disable/delete any active hook
  2. Customize email templates in Authentication > Email Templates
*/

-- Revoke the old grant in case it somehow persists (safe no-op if function doesn't exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'custom_email_hook'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.custom_email_hook(jsonb) FROM supabase_auth_admin;
    DROP FUNCTION IF EXISTS public.custom_email_hook(jsonb);
  END IF;
END $$;
