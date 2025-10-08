/*
  # Add Order-Specific Changelog

  1. New Tables
    - `order_changelog`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders)
      - `user_id` (uuid, foreign key to auth.users)
      - `field_changed` (text) - what field was changed
      - `old_value` (text) - previous value
      - `new_value` (text) - new value
      - `change_type` (text) - 'edit', 'add', 'remove', 'status_change'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `order_changelog` table
    - Add policy for authenticated users to read changelog
    - Add policy for authenticated users to create changelog entries

  3. Important Notes
    - This table tracks all changes made to orders
    - Provides audit trail for order modifications
    - Includes user tracking for accountability
*/

CREATE TABLE IF NOT EXISTS order_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  change_type text NOT NULL DEFAULT 'edit',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE order_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view order changelog"
  ON order_changelog
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create changelog entries"
  ON order_changelog
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_order_changelog_order_id ON order_changelog(order_id);
CREATE INDEX IF NOT EXISTS idx_order_changelog_created_at ON order_changelog(created_at DESC);
