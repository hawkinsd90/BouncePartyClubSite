/*
  # Add Business Name to Customers Table

  1. Changes
    - Add `business_name` column to `customers` table
      - Allows customers to specify a business name for invoicing/payments
      - Optional field (nullable)
      - Will be displayed on invoices and throughout the system when provided

  2. Notes
    - This enables B2B customers to have invoices under their business name
    - When business_name is present, it will be shown instead of or alongside the customer's personal name
    - This field was already added to contacts table but was missing from customers table
*/

-- Add business_name column to customers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'business_name'
  ) THEN
    ALTER TABLE customers ADD COLUMN business_name text;
  END IF;
END $$;
