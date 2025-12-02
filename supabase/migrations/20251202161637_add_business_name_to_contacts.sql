/*
  # Add Business Name to Contacts

  1. Changes
    - Add `business_name` column to `contacts` table
      - Allows customers to specify a business name for invoicing/payments
      - Optional field (nullable)
      - Will be displayed on invoices and throughout the system when provided

  2. Notes
    - This enables B2B customers to have invoices under their business name
    - When business_name is present, it will be shown instead of or alongside the customer's personal name
*/

-- Add business_name column to contacts table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'business_name'
  ) THEN
    ALTER TABLE contacts ADD COLUMN business_name text;
  END IF;
END $$;