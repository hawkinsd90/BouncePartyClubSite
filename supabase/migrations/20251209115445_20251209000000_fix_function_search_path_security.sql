/*
  # Fix Function Search Path Security

  1. Security Enhancement
    - Add `SET search_path = ''` to all functions that have mutable search_path
    - This prevents search_path manipulation attacks
    - Affects 19 functions across the database

  2. Functions Fixed
    - order_has_valid_signature
    - update_invoice_links_updated_at
    - get_signature_status
    - update_hero_carousel_updated_at
    - user_has_role
    - get_user_highest_role
    - assign_user_role
    - remove_user_role
    - get_user_creation_logs
    - get_user_order_prefill
    - generate_invoice_number
    - update_contact_stats
    - update_updated_at_column
    - get_admin_users
    - update_sms_template_updated_at
    - update_payment_updated_at
    - check_unit_availability
    - update_contact_booking_stats
    - log_admin_settings_change

  3. Important Notes
    - All functions now have fixed search_path for security
    - Table and function references must be schema-qualified (public.table_name)
    - This is a security best practice required by Supabase linter
*/

-- Drop functions that might have signature changes
DROP FUNCTION IF EXISTS public.assign_user_role(uuid, text);
DROP FUNCTION IF EXISTS public.remove_user_role(uuid, text);
DROP FUNCTION IF EXISTS public.get_user_creation_logs(text);
DROP FUNCTION IF EXISTS public.get_user_order_prefill();
DROP FUNCTION IF EXISTS public.get_admin_users();

-- Fix order_has_valid_signature
CREATE OR REPLACE FUNCTION public.order_has_valid_signature(order_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.order_signatures
    WHERE order_id = order_uuid
      AND signature_image_url IS NOT NULL
      AND pdf_url IS NOT NULL
  );
END;
$$;

-- Fix get_signature_status
CREATE OR REPLACE FUNCTION public.get_signature_status(order_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'has_signature', (signature_image_url IS NOT NULL),
    'has_pdf', (pdf_url IS NOT NULL),
    'signed_at', signed_at,
    'signer_name', signer_name,
    'signer_email', signer_email,
    'is_complete', (signature_image_url IS NOT NULL AND pdf_url IS NOT NULL)
  ) INTO result
  FROM public.order_signatures
  WHERE order_id = order_uuid;

  IF result IS NULL THEN
    result := jsonb_build_object(
      'has_signature', false,
      'has_pdf', false,
      'is_complete', false
    );
  END IF;

  RETURN result;
END;
$$;

-- Fix update_invoice_links_updated_at
CREATE OR REPLACE FUNCTION public.update_invoice_links_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix update_hero_carousel_updated_at
CREATE OR REPLACE FUNCTION public.update_hero_carousel_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix user_has_role
CREATE OR REPLACE FUNCTION public.user_has_role(check_user_id uuid, check_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id AND role = check_role
  );
END;
$$;

-- Fix get_user_highest_role
CREATE OR REPLACE FUNCTION public.get_user_highest_role(check_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_role text;
BEGIN
  -- Check roles in order of hierarchy: master > admin > crew > customer
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = check_user_id AND role = 'master') THEN
    RETURN 'master';
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = check_user_id AND role = 'admin') THEN
    RETURN 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = check_user_id AND role = 'crew') THEN
    RETURN 'crew';
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = check_user_id AND role = 'customer') THEN
    RETURN 'customer';
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- Fix assign_user_role
CREATE FUNCTION public.assign_user_role(
  target_user_id uuid,
  target_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only allow master and admin roles to assign roles
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('master', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only master and admin users can assign roles';
  END IF;

  -- Prevent non-master users from assigning master role
  IF target_role = 'master' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'master'
  ) THEN
    RAISE EXCEPTION 'Only master users can assign the master role';
  END IF;

  -- Insert or update the role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, target_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- Fix remove_user_role
CREATE FUNCTION public.remove_user_role(
  target_user_id uuid,
  target_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only allow master and admin roles to remove roles
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('master', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only master and admin users can remove roles';
  END IF;

  -- Prevent non-master users from removing master role
  IF target_role = 'master' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'master'
  ) THEN
    RAISE EXCEPTION 'Only master users can remove the master role';
  END IF;

  -- Delete the role
  DELETE FROM public.user_roles
  WHERE user_id = target_user_id AND role = target_role;
END;
$$;

-- Fix get_user_creation_logs
CREATE FUNCTION public.get_user_creation_logs(target_email text)
RETURNS TABLE (
  log_time timestamptz,
  trigger_source text,
  user_id uuid,
  email text,
  roles text[],
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    created_at,
    source,
    new_user_id,
    new_user_email,
    assigned_roles,
    raw_metadata
  FROM public.user_creation_logs
  WHERE new_user_email = target_email
  ORDER BY created_at DESC;
END;
$$;

-- Fix get_user_order_prefill
CREATE FUNCTION public.get_user_order_prefill()
RETURNS TABLE (
  first_name text,
  last_name text,
  email text,
  phone text,
  address_line1 text,
  city text,
  state text,
  zip text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.customer_first_name,
    o.customer_last_name,
    o.customer_email,
    o.customer_phone,
    o.address_line1,
    o.city,
    o.state,
    o.zip
  FROM public.orders o
  WHERE o.customer_id = auth.uid()
    AND o.status NOT IN ('draft', 'void')
    AND o.customer_email IS NOT NULL
  ORDER BY o.created_at DESC
  LIMIT 1;
END;
$$;

-- Fix generate_invoice_number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_number text;
  year_prefix text;
  next_num integer;
BEGIN
  year_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-';

  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '\d+$') AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';

  new_number := year_prefix || LPAD(next_num::text, 4, '0');

  RETURN new_number;
END;
$$;

-- Fix update_contact_stats
CREATE OR REPLACE FUNCTION public.update_contact_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.contacts
    SET
      total_bookings = (
        SELECT COUNT(*) FROM public.orders
        WHERE customer_email = NEW.customer_email
      ),
      total_spent_cents = (
        SELECT COALESCE(SUM(total_cents), 0) FROM public.orders
        WHERE customer_email = NEW.customer_email
      ),
      updated_at = now()
    WHERE email = NEW.customer_email;
  END IF;
  RETURN NEW;
END;
$$;

-- Fix update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix get_admin_users
CREATE FUNCTION public.get_admin_users()
RETURNS TABLE (
  id uuid,
  email text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ur.user_id,
    au.email::text,
    au.created_at
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role IN ('admin', 'master')
  ORDER BY au.created_at DESC;
END;
$$;

-- Fix update_sms_template_updated_at
CREATE OR REPLACE FUNCTION public.update_sms_template_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix update_payment_updated_at
CREATE OR REPLACE FUNCTION public.update_payment_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fix check_unit_availability
CREATE OR REPLACE FUNCTION public.check_unit_availability(
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_order_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  total_inventory integer;
  max_booked integer;
  available_count integer;
BEGIN
  SELECT inventory INTO total_inventory
  FROM public.units
  WHERE id = p_unit_id;

  IF total_inventory IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(booked_count), 0) INTO max_booked
  FROM (
    SELECT o.event_date::date as booking_date, COUNT(*) as booked_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.unit_id = p_unit_id
      AND o.status NOT IN ('draft', 'void', 'canceled')
      AND (p_exclude_order_id IS NULL OR o.id != p_exclude_order_id)
      AND o.event_date::date <= p_end_date
      AND COALESCE(o.event_end_date::date, o.event_date::date) >= p_start_date
    GROUP BY o.event_date::date
  ) AS booking_counts;

  available_count := total_inventory - max_booked;

  RETURN GREATEST(available_count, 0);
END;
$$;

-- Fix update_contact_booking_stats
CREATE OR REPLACE FUNCTION public.update_contact_booking_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  target_email text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_email := OLD.customer_email;
  ELSE
    target_email := NEW.customer_email;
  END IF;

  IF target_email IS NOT NULL THEN
    UPDATE public.contacts
    SET
      total_bookings = (
        SELECT COUNT(*)
        FROM public.orders
        WHERE customer_email = target_email
          AND status NOT IN ('draft', 'void')
      ),
      total_spent_cents = (
        SELECT COALESCE(SUM(total_cents), 0)
        FROM public.orders
        WHERE customer_email = target_email
          AND status NOT IN ('draft', 'void')
      ),
      last_booking_date = (
        SELECT MAX(event_date)
        FROM public.orders
        WHERE customer_email = target_email
          AND status NOT IN ('draft', 'void')
      ),
      updated_at = now()
    WHERE email = target_email;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Fix log_admin_settings_change
CREATE OR REPLACE FUNCTION public.log_admin_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.admin_settings_changelog (
    setting_key,
    old_value,
    new_value,
    changed_by
  )
  VALUES (
    NEW.key,
    OLD.value,
    NEW.value,
    auth.uid()
  );
  RETURN NEW;
END;
$$;
