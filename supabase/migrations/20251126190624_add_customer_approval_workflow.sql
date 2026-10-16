/*
  # Add Customer Approval Workflow

  ## Overview
  This migration adds customer approval tracking for order edits, allowing admins to
  edit orders and require customer approval before proceeding.

  ## Changes

  1. **New Columns to `orders` table**
    - `awaiting_customer_approval` (boolean) - Quick flag to check if approval is needed
    - `customer_approval_requested_at` (timestamptz) - When approval was requested
    - `customer_approved_at` (timestamptz) - When customer approved the changes
    - `edit_summary` (text) - Summary of changes made by admin

  2. **Security**
    - Update RLS policies to allow customers to view and approve their own orders
    - Public access for viewing orders (needed for invoice links)
    - Public access for updating orders (needed for customer approval)

  ## Important Notes
  - New status value 'pending_customer_approval' can be used for orders awaiting approval
  - Existing orders are not affected
  - Customers can view orders via public invoice links
*/

-- Add new columns to orders table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'awaiting_customer_approval'
  ) THEN
    ALTER TABLE orders ADD COLUMN awaiting_customer_approval boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'customer_approval_requested_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN customer_approval_requested_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'customer_approved_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN customer_approved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'edit_summary'
  ) THEN
    ALTER TABLE orders ADD COLUMN edit_summary text;
  END IF;
END $$;

-- Create policy for public to view orders (needed for invoice links sent via email/SMS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'orders'
    AND policyname = 'Public can view orders for invoice links'
  ) THEN
    CREATE POLICY "Public can view orders for invoice links"
      ON orders
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- Create policy for public to update order approval (customers approving via invoice link)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'orders'
    AND policyname = 'Public can approve orders'
  ) THEN
    CREATE POLICY "Public can approve orders"
      ON orders
      FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
