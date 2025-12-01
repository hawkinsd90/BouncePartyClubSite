/*
  # Add Saved Templates for Fees and Discounts

  1. New Tables
    - `saved_discount_templates`
      - `id` (uuid, primary key)
      - `name` (text) - Template name
      - `amount_cents` (integer) - Discount amount in cents (0 if percentage-based)
      - `percentage` (numeric) - Discount percentage (0 if amount-based)
      - `created_at` (timestamp)
    
    - `saved_fee_templates`
      - `id` (uuid, primary key)
      - `name` (text) - Template name
      - `amount_cents` (integer) - Fee amount in cents
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage templates
*/

-- Create saved_discount_templates table
CREATE TABLE IF NOT EXISTS saved_discount_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  amount_cents integer NOT NULL DEFAULT 0,
  percentage numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create saved_fee_templates table
CREATE TABLE IF NOT EXISTS saved_fee_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  amount_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE saved_discount_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_fee_templates ENABLE ROW LEVEL SECURITY;

-- Policies for discount templates
CREATE POLICY "Authenticated users can view discount templates"
  ON saved_discount_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert discount templates"
  ON saved_discount_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete discount templates"
  ON saved_discount_templates
  FOR DELETE
  TO authenticated
  USING (true);

-- Policies for fee templates
CREATE POLICY "Authenticated users can view fee templates"
  ON saved_fee_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert fee templates"
  ON saved_fee_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete fee templates"
  ON saved_fee_templates
  FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_saved_discount_templates_name ON saved_discount_templates(name);
CREATE INDEX IF NOT EXISTS idx_saved_fee_templates_name ON saved_fee_templates(name);