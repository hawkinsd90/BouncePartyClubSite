/*
  # Add Critical Performance Indexes

  1. Purpose
    - Fix missing indexes causing slow queries and table scans
    - Improve performance for frequently joined tables
    - Prevent "hung" loading behavior from slow queries

  2. New Indexes
    - `idx_orders_customer_id` - Critical for all customer order lookups
    - `idx_order_items_order_id` - Critical for loading order details
    - `idx_task_status_order_id` - Improves calendar task loading
    - `idx_payments_order_id` - Speeds up payment history queries
    - `idx_order_discounts_order_id` - Faster discount lookups
    - `idx_order_custom_fees_order_id` - Faster fee lookups
    - `idx_order_lot_pictures_order_id` - Faster lot picture loading

  3. Performance Impact
    - Reduces query time from seconds to milliseconds for order lookups
    - Prevents full table scans on large tables
    - Critical for app responsiveness with 100+ orders

  4. Notes
    - These are foreign key columns that should have been indexed from the start
    - Checking IF NOT EXISTS to prevent errors if index already exists
*/

-- Orders table: customer_id is used in nearly every customer query
CREATE INDEX IF NOT EXISTS idx_orders_customer_id 
ON orders(customer_id);

-- Order items: critical for loading order details
CREATE INDEX IF NOT EXISTS idx_order_items_order_id 
ON order_items(order_id);

-- Task status: used in calendar views to match tasks to orders
CREATE INDEX IF NOT EXISTS idx_task_status_order_id 
ON task_status(order_id);

-- Payments: frequently joined when displaying order payment history
CREATE INDEX IF NOT EXISTS idx_payments_order_id 
ON payments(order_id);

-- Order discounts: joined when calculating order totals
CREATE INDEX IF NOT EXISTS idx_order_discounts_order_id 
ON order_discounts(order_id);

-- Order custom fees: joined when calculating order totals
CREATE INDEX IF NOT EXISTS idx_order_custom_fees_order_id 
ON order_custom_fees(order_id);

-- Order lot pictures: loaded when viewing order details
CREATE INDEX IF NOT EXISTS idx_order_lot_pictures_order_id 
ON order_lot_pictures(order_id);

-- Composite index for event_date queries (very common)
CREATE INDEX IF NOT EXISTS idx_orders_event_date_status 
ON orders(event_date, status);

-- Index for calendar month queries
CREATE INDEX IF NOT EXISTS idx_task_status_task_date 
ON task_status(task_date);
