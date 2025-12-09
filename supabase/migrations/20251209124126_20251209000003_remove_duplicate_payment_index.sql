-- Remove Duplicate Index on Payments Table
-- The payments table has two identical indexes on order_id
-- Keep idx_payments_order_id (more descriptive) and drop idx_payments_order

DROP INDEX IF EXISTS idx_payments_order;
