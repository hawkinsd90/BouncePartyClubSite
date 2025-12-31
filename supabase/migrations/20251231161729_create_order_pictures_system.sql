/*
  # Create Order Pictures System

  1. New Tables
    - `order_pictures` - Stores metadata for customer-uploaded pictures
      - `id` (uuid, primary key)
      - `order_id` (uuid, references orders)
      - `file_path` (text) - Path in storage bucket
      - `file_name` (text) - Original file name
      - `file_size` (integer) - Size in bytes
      - `mime_type` (text) - MIME type
      - `notes` (text, optional) - Customer notes about the picture
      - `uploaded_by` (uuid, nullable) - User who uploaded (null for anonymous)
      - `uploaded_at` (timestamptz) - When uploaded
      - `created_at` (timestamptz) - Record creation time

  2. Storage
    - Creates 'order-pictures' bucket for customer uploads
    - Public read access for admins
    - Authenticated users can upload to their own orders
    - Anonymous users can upload with order ID validation

  3. Security
    - RLS enabled on order_pictures table
    - Admins can view all pictures
    - Customers can view pictures for their orders
    - Anyone with order ID can upload (for customer portal)
*/

-- Create order_pictures table
CREATE TABLE IF NOT EXISTS order_pictures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE order_pictures ENABLE ROW LEVEL SECURITY;

-- Admins can view all pictures
CREATE POLICY "Admins can view all order pictures"
  ON order_pictures
  FOR SELECT
  TO authenticated
  USING (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER', 'CREW')
  );

-- Customers can view pictures for their orders
CREATE POLICY "Customers can view own order pictures"
  ON order_pictures
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      JOIN contacts c ON o.customer_id = c.customer_id
      WHERE o.id = order_pictures.order_id
      AND c.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Anyone can insert pictures (used by customer portal)
-- We validate order existence in application code
CREATE POLICY "Anyone can upload order pictures"
  ON order_pictures
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM orders WHERE id = order_pictures.order_id)
  );

-- Admins can delete pictures
CREATE POLICY "Admins can delete order pictures"
  ON order_pictures
  FOR DELETE
  TO authenticated
  USING (
    UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Create storage bucket for order pictures
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-pictures',
  'order-pictures',
  false, -- Not publicly accessible
  10485760, -- 10MB limit per file
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for order-pictures bucket

-- Admins can view all pictures
CREATE POLICY "Admins can view all order pictures storage"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-pictures'
    AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER', 'CREW')
  );

-- Authenticated customers can view pictures for their orders
CREATE POLICY "Customers can view own order pictures storage"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'order-pictures'
    AND EXISTS (
      SELECT 1 FROM order_pictures op
      JOIN orders o ON op.order_id = o.id
      JOIN contacts c ON o.customer_id = c.customer_id
      WHERE op.file_path = storage.objects.name
      AND c.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Anyone can upload pictures (customer portal allows anonymous uploads)
CREATE POLICY "Anyone can upload order pictures storage"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'order-pictures');

-- Admins can update pictures
CREATE POLICY "Admins can update order pictures storage"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'order-pictures'
    AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Admins can delete pictures
CREATE POLICY "Admins can delete order pictures storage"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'order-pictures'
    AND UPPER(get_user_role(auth.uid())) IN ('ADMIN', 'MASTER')
  );

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_order_pictures_order_id ON order_pictures(order_id);
CREATE INDEX IF NOT EXISTS idx_order_pictures_uploaded_at ON order_pictures(uploaded_at DESC);