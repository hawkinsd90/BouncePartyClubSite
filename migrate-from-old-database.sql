-- =====================================================
-- DATA MIGRATION FROM OLD DATABASE TO NEW DATABASE
-- =====================================================
-- This file contains SQL to migrate data from your old Supabase instance
-- (ohtxfkaswaocdwbpyztr) to your new instance (qaagfafagdpgzcijnfbw)
--
-- IMPORTANT: Your new database already has 74 orders and 1 pending review.
-- This means data has already been migrated!
--
-- If you still want to re-sync specific data, you can use dblink or
-- manual export/import. Here's how:
--
-- METHOD 1: Export from old DB and import to new DB
-- --------------------------------------------------
-- 1. Connect to OLD database (ohtxfkaswaocdwbpyztr.supabase.co)
-- 2. Run these export queries and save results:

/*
-- Export customers
SELECT * FROM customers ORDER BY created_at;

-- Export addresses
SELECT * FROM addresses ORDER BY created_at;

-- Export units
SELECT * FROM units ORDER BY name;

-- Export orders
SELECT * FROM orders ORDER BY created_at;

-- Export order_items
SELECT * FROM order_items ORDER BY created_at;

-- Export payments
SELECT * FROM payments ORDER BY created_at;

-- Export invoices
SELECT * FROM invoices ORDER BY created_at;

-- Export contacts
SELECT * FROM contacts ORDER BY created_at;

-- Export admin_settings (careful with keys!)
SELECT * FROM admin_settings;

-- Export pricing_rules
SELECT * FROM pricing_rules;
*/

-- 3. Then connect to NEW database (qaagfafagdpgzcijnfbw.supabase.co)
-- 4. Use INSERT statements to import the data

-- METHOD 2: Using pg_dump and pg_restore
-- --------------------------------------
-- This is the recommended approach for large datasets:
--
-- From your local machine:
-- 1. Export from old database:
--    pg_dump -h db.ohtxfkaswaocdwbpyztr.supabase.co -U postgres -d postgres --data-only --table=customers --table=addresses --table=orders > old_data.sql
--
-- 2. Import to new database:
--    psql -h db.qaagfafagdpgzcijnfbw.supabase.co -U postgres -d postgres < old_data.sql

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Run these on your NEW database to verify migration:

-- Check order counts by status
SELECT status, COUNT(*) as count
FROM orders
GROUP BY status
ORDER BY count DESC;

-- Check total customers
SELECT COUNT(*) as total_customers FROM customers;

-- Check total units
SELECT COUNT(*) as total_units FROM units;

-- Check pending reviews
SELECT id, created_at, status
FROM orders
WHERE status = 'pending_review'
ORDER BY created_at DESC;

-- Check most recent orders
SELECT id, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- NOTES
-- =====================================================
-- Your new database ALREADY HAS DATA:
-- - 74 total orders
-- - 1 order with status 'pending_review'
-- - The pending review order is the most recent one (2025-10-08)
--
-- The issue you experienced was NOT missing data, but rather:
-- - The Admin page was only loading the last 20 orders total
-- - Then filtering in the UI to show only 'pending_review'
-- - This has been FIXED in the code
--
-- Your data is safe and already migrated!
