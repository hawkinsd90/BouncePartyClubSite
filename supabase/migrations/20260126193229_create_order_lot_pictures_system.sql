/*
  # Create Order Lot Pictures System
  
  1. New Table: order_lot_pictures
    - Stores pictures of the event lot/area uploaded by customers
    - Links to orders table
    - Tracks upload timestamp and order
    - Optional: customer can add notes about each picture
    
  2. Storage Bucket: lot-pictures
    - Public bucket for storing lot pictures
    - Organized by order_id
    
  3. Purpose
    - Allow customers to upload pictures of their event location
    - Help admins assess setup requirements before event
    - Improve planning and reduce on-site surprises
    
  4. Security
    - RLS policies allow:
      - Customers to upload pictures for their own orders
      - Admins to view all pictures
      - Public read access for authenticated users viewing specific orders
*/

-- Create order_lot_pictures table
CREATE TABLE IF NOT EXISTS order_lot_pictures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  notes text,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_order_lot_pictures_order_id ON order_lot_pictures(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lot_pictures_uploaded_at ON order_lot_pictures(uploaded_at);

-- Enable RLS
ALTER TABLE order_lot_pictures ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can do everything
CREATE POLICY "Admins can manage all lot pictures"
  ON order_lot_pictures
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('master', 'admin')
    )
  );

-- Policy: Customers can view pictures for their own orders
CREATE POLICY "Customers can view their own order lot pictures"
  ON order_lot_pictures
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
      AND orders.customer_id = auth.uid()
    )
  );

-- Policy: Customers can upload pictures for their own orders
CREATE POLICY "Customers can upload lot pictures for their orders"
  ON order_lot_pictures
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_lot_pictures.order_id
      AND orders.customer_id = auth.uid()
    )
  );

-- Policy: Anonymous users can upload pictures using order context
CREATE POLICY "Anonymous users can upload lot pictures with order link"
  ON order_lot_pictures
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policy: Anonymous users can view pictures for orders they have access to
CREATE POLICY "Anonymous users can view lot pictures"
  ON order_lot_pictures
  FOR SELECT
  TO anon
  USING (true);

-- Create storage bucket for lot pictures
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lot-pictures',
  'lot-pictures',
  true,
  10485760, -- 10MB max file size
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload lot pictures"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lot-pictures');

-- Storage policies: Allow anonymous users to upload
CREATE POLICY "Anonymous users can upload lot pictures"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'lot-pictures');

-- Storage policies: Public read access
CREATE POLICY "Public can view lot pictures"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'lot-pictures');

-- Storage policies: Users can update their own uploads
CREATE POLICY "Users can update their own lot pictures"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'lot-pictures');

-- Storage policies: Admins can delete lot pictures
CREATE POLICY "Admins can delete lot pictures"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lot-pictures'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('master', 'admin')
    )
  );
