/*
  # Fix all RLS policies to use lowercase role comparisons

  ## Problem
  After normalizing roles to lowercase in user_roles, dozens of RLS policies
  still compare against uppercase values ('ADMIN', 'MASTER', 'CREW').
  This breaks admin access to virtually every protected table.

  ## Fix
  Drop and recreate every affected policy using LOWER(role) or lowercase literals.
  Storage (objects) policies use get_user_role() which already returns lowercase,
  so those are fixed by switching from upper(get_user_role()) = 'ADMIN' to
  get_user_role() = 'admin'.
*/

-- ============================================================
-- admin_settings
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can view all settings" ON admin_settings;

CREATE POLICY "Admins can delete settings" ON admin_settings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can insert settings" ON admin_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can update settings" ON admin_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can view all settings" ON admin_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- admin_settings_changelog
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert changelog" ON admin_settings_changelog;
DROP POLICY IF EXISTS "Admins can view changelog" ON admin_settings_changelog;

CREATE POLICY "Admins can insert changelog" ON admin_settings_changelog FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can view changelog" ON admin_settings_changelog FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- auth_trigger_logs
-- ============================================================
DROP POLICY IF EXISTS "Admins can view auth logs" ON auth_trigger_logs;

CREATE POLICY "Admins can view auth logs" ON auth_trigger_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- consent_records
-- ============================================================
DROP POLICY IF EXISTS "Users can create own consent records" ON consent_records;

CREATE POLICY "Users can create own consent records" ON consent_records FOR INSERT TO authenticated
  WITH CHECK (
    (customer_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master']))
  );

-- ============================================================
-- crew_location_history
-- ============================================================
DROP POLICY IF EXISTS "Authenticated crew and admins can log location" ON crew_location_history;

CREATE POLICY "Authenticated crew and admins can log location" ON crew_location_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin','crew'])));

-- ============================================================
-- customer_profiles
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all profiles" ON customer_profiles;

CREATE POLICY "Admins can view all profiles" ON customer_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- hero_carousel_images (uses get_user_role which now returns lowercase)
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can insert carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can update carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can view all carousel images" ON hero_carousel_images;

CREATE POLICY "Admins can delete carousel images" ON hero_carousel_images FOR DELETE TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can insert carousel images" ON hero_carousel_images FOR INSERT TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can update carousel images" ON hero_carousel_images FOR UPDATE TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']))
  WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can view all carousel images" ON hero_carousel_images FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

-- ============================================================
-- invoices
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can update invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can view all invoices" ON invoices;

CREATE POLICY "Admins can insert invoices" ON invoices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can update invoices" ON invoices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can view all invoices" ON invoices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- order_discounts
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage discounts" ON order_discounts;

CREATE POLICY "Admins can manage discounts" ON order_discounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- order_lot_pictures
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete any lot pictures" ON order_lot_pictures;

CREATE POLICY "Admins can delete any lot pictures" ON order_lot_pictures FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- order_notes
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage order notes" ON order_notes;

CREATE POLICY "Admins can manage order notes" ON order_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- order_pictures (uses get_user_role)
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete order pictures" ON order_pictures;
DROP POLICY IF EXISTS "Admins can view all order pictures" ON order_pictures;

CREATE POLICY "Admins can delete order pictures" ON order_pictures FOR DELETE TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can view all order pictures" ON order_pictures FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin','master','crew']));

-- ============================================================
-- order_refunds
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage refunds" ON order_refunds;

CREATE POLICY "Admins can manage refunds" ON order_refunds FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- order_workflow_events
-- ============================================================
DROP POLICY IF EXISTS "Admins and crew can manage workflow events" ON order_workflow_events;

CREATE POLICY "Admins and crew can manage workflow events" ON order_workflow_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','crew','master'])));

-- ============================================================
-- saved_discount_templates
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage discount templates" ON saved_discount_templates;

CREATE POLICY "Admins can manage discount templates" ON saved_discount_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- saved_fee_templates
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage fee templates" ON saved_fee_templates;

CREATE POLICY "Admins can manage fee templates" ON saved_fee_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- sms_conversations
-- ============================================================
DROP POLICY IF EXISTS "Admins can insert conversations" ON sms_conversations;
DROP POLICY IF EXISTS "Admins can view conversations" ON sms_conversations;

CREATE POLICY "Admins can insert conversations" ON sms_conversations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

CREATE POLICY "Admins can view conversations" ON sms_conversations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['admin','master'])));

-- ============================================================
-- stripe_webhook_events
-- ============================================================
DROP POLICY IF EXISTS "Admin users can view webhook events" ON stripe_webhook_events;

CREATE POLICY "Admin users can view webhook events" ON stripe_webhook_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- task_status
-- ============================================================
DROP POLICY IF EXISTS "Admin users can delete task statuses" ON task_status;
DROP POLICY IF EXISTS "Admin users can insert task statuses" ON task_status;
DROP POLICY IF EXISTS "Admin users can update task statuses" ON task_status;
DROP POLICY IF EXISTS "Admin users can view all task statuses" ON task_status;

CREATE POLICY "Admin users can delete task statuses" ON task_status FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

CREATE POLICY "Admin users can insert task statuses" ON task_status FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

CREATE POLICY "Admin users can update task statuses" ON task_status FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin','crew'])))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin','crew'])));

CREATE POLICY "Admin users can view all task statuses" ON task_status FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin','crew'])));

-- ============================================================
-- transaction_receipts
-- ============================================================
DROP POLICY IF EXISTS "Admin users can insert transaction receipts" ON transaction_receipts;
DROP POLICY IF EXISTS "Admin users can view all transaction receipts" ON transaction_receipts;

CREATE POLICY "Admin users can insert transaction receipts" ON transaction_receipts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

CREATE POLICY "Admin users can view all transaction receipts" ON transaction_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- user_consent_log
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all consent records" ON user_consent_log;

CREATE POLICY "Admins can view all consent records" ON user_consent_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND LOWER(user_roles.role) = ANY (ARRAY['master','admin'])));

-- ============================================================
-- Storage: unit-images, carousel-media, order-pictures
-- (these use get_user_role which now returns lowercase)
-- ============================================================
DROP POLICY IF EXISTS "Admin can delete unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can update unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can upload unit images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload carousel media" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete order pictures storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update order pictures storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all order pictures storage" ON storage.objects;

CREATE POLICY "Admin can delete unit images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'unit-images' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admin can update unit images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'unit-images' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']))
  WITH CHECK (bucket_id = 'unit-images' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admin can upload unit images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'unit-images' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can delete carousel media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'carousel-media' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can update carousel media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'carousel-media' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']))
  WITH CHECK (bucket_id = 'carousel-media' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can upload carousel media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'carousel-media' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can delete order pictures storage" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'order-pictures' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can update order pictures storage" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'order-pictures' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master']));

CREATE POLICY "Admins can view all order pictures storage" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-pictures' AND get_user_role(auth.uid()) = ANY (ARRAY['admin','master','crew']));
