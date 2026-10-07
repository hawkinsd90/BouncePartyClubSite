/*
  # Payment Safety A2.1 — canonical order-bound portal links

  Additive and safe for BOTH Dev and Production (written against a read-only comparison of the two). It reuses the
  existing public.invoice_links table as the single canonical customer-link store. It does NOT drop or change any
  invoice_links policy or grant, does not touch orders/customers RLS, and does not delete or rewrite data.

  ## What exists today (verified live on Dev and Production)
  - invoice_links(id, order_id, link_token text UNIQUE default 32 random bytes hex, customer_filled, deposit_cents,
    expires_at default now()+7 days, created_at, updated_at, short_code, link_type default 'invoice').
  - link_type values in use: 'invoice' (admin invoices) and 'portal_shortlink' (legacy 8-char short links, every row
    already expired). short_code has a partial UNIQUE index.
  - Trigger trg_sync_invoice_links_expires_at on orders rewrote expires_at for EVERY link of an order (expired ones
    included) to event_date + 3 days whenever event_date changed, which can bring an expired security token back to
    life when an order is rescheduled.
  - The Dev-only public.order_portal_links table (created by migration 20260722212750) is LEGACY: its only possible
    result is a UUID-only URL, Production has neither it nor create_order_short_link / resolve_portal_short_link.
    A2.1 does not read or build on it.

  ## 1. revoked_at
  invoice_links.revoked_at (timestamptz, nullable). Revocation is sticky and effective everywhere:
    - a BEFORE INSERT/UPDATE trigger never lets revoked_at be cleared once set, and forces expires_at <= revoked_at,
      so every existing validator that only checks "expires_at > now()" (the SQL token RPCs, the invoice_links
      "valid token" policies, the Edge Function validator) rejects a revoked link without being rewritten.
    - The Edge Function validator additionally checks revoked_at IS NULL explicitly.

  ## 2. One active canonical portal link per order
  Partial UNIQUE index on (order_id) WHERE link_type = 'portal' AND revoked_at IS NULL. Expired-but-unrevoked rows
  still occupy that slot, so the server helper retires an expired portal link (sets revoked_at) before minting its
  replacement. link_type 'portal' is a value, not a new table; no CHECK constraint is added so legacy values keep working.

  ## 3. Expiry rule for portal links
  expires_at = start of the day after (COALESCE(event_end_date, event_date) + 60 days), i.e. valid through the whole
  60th day after the event. If neither date exists the server helper uses issuance time + 60 days (documented
  fallback; the trigger leaves such a link alone until a date appears).

  ## 4. sync_invoice_links_expires_at (corrected)
  Fires when event_date OR event_end_date changes. Exact semantics:
    - ACTIVE portal links (not revoked, not yet expired) follow the new portal expiry rule.
    - Legacy/invoice links keep their previous rule (event_date + 3 days) but ONLY when event_date changed, and
      ONLY if they are currently active (not revoked, expires_at not null and still in the future).
    - Expired and revoked links are never touched, so a date change cannot resurrect them.
    - Order dates themselves are never modified.

  ## Not changed
  invoice_links policies and grants (A2.4), orders/customers RLS (A2.4), get_order_by_token and
  get_order_with_relations_by_token bodies (they honor revocation through expires_at), order_portal_links (deferred
  cleanup), create_order_short_link / create_portal_short_link / resolve_portal_short_link (legacy, no longer
  called by the application after A2.1).
*/

-- 1. revoked_at -----------------------------------------------------------------------------------------------
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- 2. one active canonical portal link per order -----------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_per_order
  ON public.invoice_links (order_id)
  WHERE link_type = 'portal' AND revoked_at IS NULL;

-- Resolver / validator lookups are by short_code (unique index exists) and link_token (unique constraint exists).

-- 3. portal expiry rule ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_link_expires_at(p_event_end_date date, p_event_date date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_event_end_date, p_event_date) IS NULL THEN NULL
    ELSE ((COALESCE(p_event_end_date, p_event_date) + 61)::timestamp AT TIME ZONE 'UTC')
  END;
$$;

REVOKE ALL ON FUNCTION public.portal_link_expires_at(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_link_expires_at(date, date) TO service_role;

-- 4. revocation is sticky and implies expiry --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_links_enforce_revocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at > NEW.revoked_at) THEN
    NEW.expires_at := NEW.revoked_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_links_enforce_revocation ON public.invoice_links;
CREATE TRIGGER trg_invoice_links_enforce_revocation
  BEFORE INSERT OR UPDATE ON public.invoice_links
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_links_enforce_revocation();

-- 5. corrected expiry sync ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_invoice_links_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_portal_expiry timestamptz;
BEGIN
  IF NEW.event_date IS DISTINCT FROM OLD.event_date
     OR NEW.event_end_date IS DISTINCT FROM OLD.event_end_date THEN

    v_portal_expiry := public.portal_link_expires_at(NEW.event_end_date, NEW.event_date);

    IF v_portal_expiry IS NOT NULL THEN
      UPDATE public.invoice_links
         SET expires_at = v_portal_expiry,
             updated_at = now()
       WHERE order_id = NEW.id
         AND link_type = 'portal'
         AND revoked_at IS NULL
         AND expires_at > now();
    END IF;
  END IF;

  IF NEW.event_date IS DISTINCT FROM OLD.event_date AND NEW.event_date IS NOT NULL THEN
    UPDATE public.invoice_links
       SET expires_at = (NEW.event_date::date + interval '3 days'),
           updated_at = now()
     WHERE order_id = NEW.id
       AND link_type <> 'portal'
       AND revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at > now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_links_expires_at ON public.orders;
CREATE TRIGGER trg_sync_invoice_links_expires_at
  AFTER UPDATE OF event_date, event_end_date ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_links_expires_at();
