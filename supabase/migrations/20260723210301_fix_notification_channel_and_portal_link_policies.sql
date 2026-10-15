-- Add channel column to notification_failures (sms, email, etc.)
ALTER TABLE notification_failures
  ADD COLUMN IF NOT EXISTS channel text;

-- Add RLS policies for order_portal_links so authenticated staff can manage links
-- RLS is enabled but has no policies, so all access is blocked.
CREATE POLICY "Staff can read order portal links"
  ON order_portal_links
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Staff can insert order portal links"
  ON order_portal_links
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Staff can update order portal links"
  ON order_portal_links
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Staff can delete order portal links"
  ON order_portal_links
  FOR DELETE
  TO authenticated
  USING (true);
