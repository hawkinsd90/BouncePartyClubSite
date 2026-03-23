/*
  # Redact secret values in admin_settings_changelog

  ## Summary
  The `admin_settings_changelog` table stores old and new values for every change
  made to admin settings. For sensitive keys (stripe_secret_key, twilio_auth_token,
  resend_api_key, and any key containing "secret", "key", "token", or "password"),
  this migration:

  1. Backfills existing rows — replaces stored plaintext secret values with
     the redacted string "[REDACTED]".
  2. Creates a BEFORE INSERT trigger that automatically redacts secret values
     on all future changelog inserts, so plaintext secrets are never persisted.

  ## Changes
  - Backfills `old_value` / `new_value` for known-sensitive setting keys
  - Adds `redact_sensitive_changelog_values()` trigger function (SECURITY DEFINER)
  - Attaches trigger `trg_redact_settings_changelog` BEFORE INSERT on
    `admin_settings_changelog`

  ## Security
  - Secrets are never stored in plaintext in the audit log
  - "[REDACTED]" sentinel makes it clear a value existed but was intentionally hidden
  - Does not affect the ability to audit *that* a change occurred — timestamp, user,
    and setting key are still recorded
*/

UPDATE admin_settings_changelog
SET
  old_value = '[REDACTED]',
  new_value = '[REDACTED]'
WHERE
  setting_key IN ('stripe_secret_key', 'twilio_auth_token', 'resend_api_key')
  OR setting_key ILIKE '%secret%'
  OR setting_key ILIKE '%_key'
  OR setting_key ILIKE '%token%'
  OR setting_key ILIKE '%password%';

CREATE OR REPLACE FUNCTION redact_sensitive_changelog_values()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.setting_key IN ('stripe_secret_key', 'twilio_auth_token', 'resend_api_key')
     OR NEW.setting_key ILIKE '%secret%'
     OR NEW.setting_key ILIKE '%_key'
     OR NEW.setting_key ILIKE '%token%'
     OR NEW.setting_key ILIKE '%password%'
  THEN
    NEW.old_value := '[REDACTED]';
    NEW.new_value := '[REDACTED]';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_redact_settings_changelog ON admin_settings_changelog;

CREATE TRIGGER trg_redact_settings_changelog
  BEFORE INSERT ON admin_settings_changelog
  FOR EACH ROW
  EXECUTE FUNCTION redact_sensitive_changelog_values();
