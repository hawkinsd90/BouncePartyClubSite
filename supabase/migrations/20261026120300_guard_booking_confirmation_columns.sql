/*
  # Booking-confirmation columns are written by the server only (Step 3B: SEC-047, also narrows SEC-035)

  Step 3B corrective migration. It belongs to the coordinated Step 4 Development rollout (and, after Development is proven and a release is
  approved, the separate Production release) and is applied only through the approved Step 4 mechanism, in version order, after the October
  block (20261025120000) and the earlier Step 3B files, together with the read-only pre/post checks in
  audit/security/step3b-verification-rules.json. It is never run ad hoc; the migration history records it only after it succeeded. Needs 20261017120000 (the columns) and 20261021120000 (the guard pattern) first.

  ## Problem
  `orders.booking_confirmation_claim_id`, `booking_confirmation_claimed_at` and `booking_confirmation_sent` decide whether the
  booking confirmation email/SMS goes out exactly once. They are written by the SECURITY DEFINER claim/finalize/release functions
  and by `complete-booking` (service role). The browser never writes them (checked: no `src` write, only reads). But the browser
  roles hold table-level UPDATE on `orders`, and the staff policies ("Admin and master manage orders", "Crew update orders") allow
  UPDATE of every column that the pricing guard does not list, so a signed-in Crew or Admin session could clear a claim and cause a
  duplicate confirmation, or set `booking_confirmation_sent` to suppress one. (This is the claim-column part of the "Crew update
  orders" residual recorded as SEC-035.) A column-level REVOKE cannot subtract from a table-level grant, and replacing the grant
  with a column list would make every future orders column unwritable by the staff UI, so the existing guard pattern is used
  instead (the same one as 20261021120000 / 20261022120000).

  ## Fix
  A BEFORE INSERT/UPDATE trigger on `orders` rejects a change to those three columns when the session role is `authenticated` or
  `anon`. The service role, the table owner and SECURITY DEFINER functions (which run as their owner) are not restricted, so the
  claim functions and complete-booking behave as before. An INSERT may set the columns only to their defaults (browser roles have not been
  able to INSERT into `orders` since 20261021120000, so that branch is defence in depth). Nothing else about `orders` changes. Safe to run twice (CREATE OR REPLACE, DROP TRIGGER IF EXISTS).
*/

CREATE OR REPLACE FUNCTION public.guard_booking_confirmation_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.booking_confirmation_claim_id IS NOT NULL
       OR NEW.booking_confirmation_claimed_at IS NOT NULL
       OR COALESCE(NEW.booking_confirmation_sent, false) THEN
      RAISE EXCEPTION 'Booking confirmation state is managed by the server and cannot be set directly.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.booking_confirmation_claim_id IS DISTINCT FROM OLD.booking_confirmation_claim_id
     OR NEW.booking_confirmation_claimed_at IS DISTINCT FROM OLD.booking_confirmation_claimed_at
     OR NEW.booking_confirmation_sent IS DISTINCT FROM OLD.booking_confirmation_sent THEN
    RAISE EXCEPTION 'Booking confirmation state is managed by the server and cannot be changed directly.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_booking_confirmation_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_confirmation_columns ON public.orders;
CREATE TRIGGER trg_guard_booking_confirmation_columns
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_confirmation_columns();
