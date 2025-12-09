-- Add Foreign Key Indexes for Performance
-- Addresses unindexed_foreign_keys warnings by creating indexes on all foreign key columns
-- This improves JOIN performance and query optimization

-- admin_settings_changelog
CREATE INDEX IF NOT EXISTS idx_admin_settings_changelog_changed_by 
  ON public.admin_settings_changelog(changed_by);

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_default_address_id 
  ON public.customers(default_address_id);

-- order_changelog
CREATE INDEX IF NOT EXISTS idx_order_changelog_user_id 
  ON public.order_changelog(user_id);

-- order_discounts (two foreign keys)
CREATE INDEX IF NOT EXISTS idx_order_discounts_created_by 
  ON public.order_discounts(created_by);
CREATE INDEX IF NOT EXISTS idx_order_discounts_order_id 
  ON public.order_discounts(order_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_unit_id 
  ON public.order_items(unit_id);

-- order_notes
CREATE INDEX IF NOT EXISTS idx_order_notes_user_id 
  ON public.order_notes(user_id);

-- order_refunds (two foreign keys)
CREATE INDEX IF NOT EXISTS idx_order_refunds_order_id 
  ON public.order_refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_order_refunds_refunded_by 
  ON public.order_refunds(refunded_by);

-- order_workflow_events
CREATE INDEX IF NOT EXISTS idx_order_workflow_events_user_id 
  ON public.order_workflow_events(user_id);

-- orders (two foreign keys)
CREATE INDEX IF NOT EXISTS idx_orders_address_id 
  ON public.orders(address_id);
CREATE INDEX IF NOT EXISTS idx_orders_signature_id 
  ON public.orders(signature_id);
