/*
  # Role lookup is self-only; a customer cannot rewrite their profile's contact link

  ## 1. get_user_role(uuid)
  The function is SECURITY DEFINER and accepted any user id, so every signed-in user could look up the role of any other user
  (an Admin or Master account included). Its callers only ever ask about the signed-in user themselves:
  - the row level security policies pass auth.uid() (19 policies on Dev, every migration use is get_user_role(auth.uid()))
  - promote-media passes the caller's own id
  - upload-physical-waiver runs as the backend and passes the id of the user it has just authenticated

  New contract (same signature, return type and default):
  - the backend (service_role) may ask about any user
  - a signed-in user gets the answer only for their own id; for any other id the answer is NULL (the same for every other id,
    so nothing can be told apart)
  - anonymous callers have no execute privilege
  - a NULL id still answers 'customer', as before
  - when a user holds more than one role row the answer is deterministic and uses the order the rest of the application uses:
    master, then admin, then crew, then customer (the old LIMIT 1 picked an arbitrary row)
  The role setting (applied per request by the API gateway) identifies the backend - the service role, or a privileged database
  session that never switched role; an API caller always runs as anon, authenticated or service_role and cannot set it. The
  function does not call itself or any other helper to authorize.

  ## 2. customer_profiles.contact_id
  contact_id links a signed-in account to the CRM contact (and through it the customer) whose orders it owns:
  current_customer_ids() and the waiver / order ownership checks follow customer_profiles.user_id -> contact_id ->
  contacts.customer_id. Only the sign-up trigger (SECURITY DEFINER, run by the backend) sets it. The "Users can update own
  profile" policy checks only user_id, and authenticated held UPDATE on every column, so a signed-in customer could set
  contact_id to ANY contact id and thereby claim that contact's customer's orders.

  authenticated keeps UPDATE only on the columns a customer legitimately edits (name, phone and notification preferences,
  plus updated_at); id, user_id, contact_id and created_at become server-managed. SELECT of their own row is unchanged. The
  backend (service_role) and the sign-up trigger are unaffected. Nothing in the web app writes this table.
*/

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. get_user_role
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role(user_id_input uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
BEGIN
  IF user_id_input IS NULL THEN
    RETURN 'customer';
  END IF;

  -- Only the backend may look at somebody else: the service role, or a privileged database session that has not switched role
  -- (maintenance, SQL editor, scheduled jobs). Everyone else gets their own answer, and NULL for any other id.
  IF COALESCE(current_setting('role', true), 'none') NOT IN ('service_role', 'none') THEN
    IF v_caller IS NULL OR user_id_input <> v_caller THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT lower(btrim(ur.role))
  INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = user_id_input
  ORDER BY
    CASE lower(btrim(ur.role))
      WHEN 'master' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'crew' THEN 3
      WHEN 'customer' THEN 4
      ELSE 5
    END,
    ur.created_at,
    ur.id
  LIMIT 1;

  RETURN COALESCE(v_role, 'customer');
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. customer_profiles: contact_id (and the other identity columns) are server-managed
-- ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.customer_profiles FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.customer_profiles FROM authenticated;
GRANT SELECT ON TABLE public.customer_profiles TO authenticated;

DO $$
DECLARE
  editable text[] := ARRAY['display_name', 'phone', 'email_notifications', 'sms_notifications', 'first_name', 'last_name', 'updated_at'];
  cols text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'customer_profiles' AND column_name = ANY (editable);

  IF cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON TABLE public.customer_profiles TO authenticated', cols);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_profiles TO service_role;
