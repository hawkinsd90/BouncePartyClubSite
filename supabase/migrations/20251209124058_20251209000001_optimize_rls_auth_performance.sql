-- Optimize RLS Policies for Performance
-- Wraps all auth.uid() calls with (select auth.uid()) to prevent re-evaluation per row
-- This improves query performance at scale

-- Drop and recreate customer_profiles policies
DROP POLICY IF EXISTS "Users can update own profile" ON customer_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON customer_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON customer_profiles;

CREATE POLICY "Users can view own profile"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own profile"
  ON customer_profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Admins can view all profiles"
  ON customer_profiles FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['MASTER', 'ADMIN'])
  ));

-- Drop and recreate order_changelog policies
DROP POLICY IF EXISTS "Authenticated users can create changelog entries" ON order_changelog;

CREATE POLICY "Authenticated users can create changelog entries"
  ON order_changelog FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- Drop and recreate consent_records policies
DROP POLICY IF EXISTS "Users can view own consent records" ON consent_records;
DROP POLICY IF EXISTS "Users can create own consent records" ON consent_records;

CREATE POLICY "Users can view own consent records"
  ON consent_records FOR SELECT
  TO authenticated
  USING (
    customer_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = (select auth.uid())
      AND role = 'admin'
    )
  );

CREATE POLICY "Users can create own consent records"
  ON consent_records FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = (select auth.uid()));

-- Drop and recreate order_signatures policies
DROP POLICY IF EXISTS "Users can view own signatures" ON order_signatures;
DROP POLICY IF EXISTS "Users can create own signatures" ON order_signatures;
DROP POLICY IF EXISTS "Admins can view all signatures" ON order_signatures;
DROP POLICY IF EXISTS "Admins can update signatures" ON order_signatures;

CREATE POLICY "Users can view own signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (
    customer_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = (select auth.uid())
      AND role = 'admin'
    )
  );

CREATE POLICY "Users can create own signatures"
  ON order_signatures FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = (select auth.uid()));

CREATE POLICY "Admins can view all signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

CREATE POLICY "Admins can update signatures"
  ON order_signatures FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

-- Drop and recreate user_roles policies
DROP POLICY IF EXISTS "Users can read own roles" ON user_roles;

CREATE POLICY "Users can read own roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- Drop and recreate orders policies
DROP POLICY IF EXISTS "Customers can view own orders" ON orders;

CREATE POLICY "Customers can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM customer_profiles cp
      JOIN contacts c ON c.id = cp.contact_id
      WHERE cp.user_id = (select auth.uid())
      AND orders.customer_id = c.customer_id
    )
    OR EXISTS (
      SELECT 1
      FROM contacts c
      WHERE c.email = (
        SELECT email FROM auth.users WHERE id = (select auth.uid())
      )::text
      AND orders.customer_id = c.customer_id
    )
  );

-- Drop and recreate payments policies
DROP POLICY IF EXISTS "Users can view own order payments" ON payments;

CREATE POLICY "Users can view own order payments"
  ON payments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM orders
    JOIN contacts ON orders.customer_id = contacts.customer_id
    WHERE orders.id = payments.order_id
    AND contacts.email = (
      SELECT email FROM auth.users WHERE id = (select auth.uid())
    )::text
  ));

-- Drop and recreate admin_settings policies with optimized auth.uid()
DROP POLICY IF EXISTS "Admins can view all settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON admin_settings;
DROP POLICY IF EXISTS "Admins can delete settings" ON admin_settings;

CREATE POLICY "Admins can view all settings"
  ON admin_settings FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can insert settings"
  ON admin_settings FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can update settings"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can delete settings"
  ON admin_settings FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate admin_settings_changelog policies
DROP POLICY IF EXISTS "Admins can view changelog" ON admin_settings_changelog;
DROP POLICY IF EXISTS "Admins can insert changelog" ON admin_settings_changelog;

CREATE POLICY "Admins can view changelog"
  ON admin_settings_changelog FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admins can insert changelog"
  ON admin_settings_changelog FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

-- Drop and recreate auth_trigger_logs policies
DROP POLICY IF EXISTS "Admins can view auth logs" ON auth_trigger_logs;

CREATE POLICY "Admins can view auth logs"
  ON auth_trigger_logs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['MASTER', 'ADMIN'])
  ));

-- Drop and recreate contacts policies (keeping duplicates for now)
DROP POLICY IF EXISTS "Admin users can read all contacts" ON contacts;
DROP POLICY IF EXISTS "Admin users can insert contacts" ON contacts;
DROP POLICY IF EXISTS "Admin users can update contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can view all contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can insert contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can update contacts" ON contacts;

CREATE POLICY "Admin users can read all contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admin users can insert contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admin users can update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admins can view all contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can insert contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can update contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate crew_location_history policies
DROP POLICY IF EXISTS "Admins can view all location history" ON crew_location_history;

CREATE POLICY "Admins can view all location history"
  ON crew_location_history FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

-- Drop and recreate hero_carousel_images policies
DROP POLICY IF EXISTS "Admins can view all carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can insert carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can update carousel images" ON hero_carousel_images;
DROP POLICY IF EXISTS "Admins can delete carousel images" ON hero_carousel_images;

CREATE POLICY "Admins can view all carousel images"
  ON hero_carousel_images FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can insert carousel images"
  ON hero_carousel_images FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can update carousel images"
  ON hero_carousel_images FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can delete carousel images"
  ON hero_carousel_images FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate invoice_links policies
DROP POLICY IF EXISTS "Admins can manage invoice links" ON invoice_links;

CREATE POLICY "Admins can manage invoice links"
  ON invoice_links FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

-- Drop and recreate invoices policies (keeping duplicates for now)
DROP POLICY IF EXISTS "Admin users can read all invoices" ON invoices;
DROP POLICY IF EXISTS "Admin users can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Admin users can update invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can view all invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Admins can update invoices" ON invoices;

CREATE POLICY "Admin users can read all invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admin users can insert invoices"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admin users can update invoices"
  ON invoices FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admins can view all invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can insert invoices"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can update invoices"
  ON invoices FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate order_discounts policies
DROP POLICY IF EXISTS "Admins can manage discounts" ON order_discounts;

CREATE POLICY "Admins can manage discounts"
  ON order_discounts FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate order_notes policies
DROP POLICY IF EXISTS "Admins can manage order notes" ON order_notes;

CREATE POLICY "Admins can manage order notes"
  ON order_notes FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

-- Drop and recreate order_refunds policies
DROP POLICY IF EXISTS "Admins can manage refunds" ON order_refunds;

CREATE POLICY "Admins can manage refunds"
  ON order_refunds FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

-- Drop and recreate order_workflow_events policies
DROP POLICY IF EXISTS "Admins and crew can manage workflow events" ON order_workflow_events;

CREATE POLICY "Admins and crew can manage workflow events"
  ON order_workflow_events FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'CREW'])
  ));

-- Drop and recreate saved_discount_templates policies
DROP POLICY IF EXISTS "Admins can manage discount templates" ON saved_discount_templates;

CREATE POLICY "Admins can manage discount templates"
  ON saved_discount_templates FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate saved_fee_templates policies
DROP POLICY IF EXISTS "Admins can manage fee templates" ON saved_fee_templates;

CREATE POLICY "Admins can manage fee templates"
  ON saved_fee_templates FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate sms_conversations policies (keeping duplicates for now)
DROP POLICY IF EXISTS "Admin users can read SMS conversations" ON sms_conversations;
DROP POLICY IF EXISTS "Admin users can insert SMS conversations" ON sms_conversations;
DROP POLICY IF EXISTS "Admins can view conversations" ON sms_conversations;
DROP POLICY IF EXISTS "Admins can insert conversations" ON sms_conversations;

CREATE POLICY "Admin users can read SMS conversations"
  ON sms_conversations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admin users can insert SMS conversations"
  ON sms_conversations FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'ADMIN'
  ));

CREATE POLICY "Admins can view conversations"
  ON sms_conversations FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

CREATE POLICY "Admins can insert conversations"
  ON sms_conversations FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = ANY(ARRAY['ADMIN', 'MASTER'])
  ));

-- Drop and recreate task_status policies
DROP POLICY IF EXISTS "Admins can view all task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can insert task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can update task statuses" ON task_status;
DROP POLICY IF EXISTS "Admins can delete task statuses" ON task_status;

CREATE POLICY "Admins can view all task statuses"
  ON task_status FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

CREATE POLICY "Admins can insert task statuses"
  ON task_status FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

CREATE POLICY "Admins can update task statuses"
  ON task_status FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));

CREATE POLICY "Admins can delete task statuses"
  ON task_status FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = (select auth.uid())
    AND role = 'admin'
  ));
