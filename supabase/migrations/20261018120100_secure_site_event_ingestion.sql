/*
  # Site events: no direct anonymous writes

  site_events is the analytics table (page, unit, cart and checkout events). The website used to insert into it straight from
  the browser with the public anon key, through a policy that let anon and authenticated insert ANY row ("WITH CHECK (true)").
  Anyone holding the public key could therefore fill the table with unlimited, arbitrarily large rows, point order / unit
  references at records of their choosing, and probe which ids exist through foreign-key errors.

  Events are now recorded by the record-site-event Edge Function, which accepts only the known event names, bounds every
  field, rate limits by request origin and inserts with the service role. This migration closes the direct path:

  - every INSERT / ALL policy on site_events is dropped (the Admin read policy stays)
  - anon and authenticated lose INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER and REFERENCES; anon also loses SELECT (it never had
    a read policy). Signed-in Admins keep SELECT for the Site Analytics screen (the existing policy still limits it to Admin /
    Master).
  - service_role keeps SELECT and INSERT (the ingestion function, and reporting).

  Existing rows, indexes and constraints are untouched. No historical row is rewritten; event names are validated at the
  ingestion boundary rather than by a CHECK because older rows carry names the current site no longer sends (quote_started,
  quote_submitted).
*/

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'site_events' AND cmd IN ('INSERT', 'ALL', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.site_events', p.policyname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.site_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.site_events FROM authenticated;
GRANT SELECT ON TABLE public.site_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.site_events TO service_role;
