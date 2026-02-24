/*
  # Create Google Reviews System

  1. New Tables
    - `google_reviews`
      - `id` (uuid, primary key)
      - `reviewer_name` (text) - Name of the person who left the review
      - `reviewer_initial` (text) - First letter of name for avatar
      - `rating` (integer) - Star rating (1-5)
      - `review_text` (text) - The review content
      - `review_date` (text) - Date when review was posted (e.g., "7 months ago")
      - `google_review_url` (text) - Link to the actual review on Google
      - `is_active` (boolean) - Whether to display this review
      - `display_order` (integer) - Order in which to display reviews
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `google_reviews` table
    - Add policy for public read access (4-5 star reviews only)
    - Add policy for authenticated admin users to manage all reviews

  3. Seed Data
    - Insert existing Shawna Taleah review
*/

-- Create google_reviews table
CREATE TABLE IF NOT EXISTS google_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_name text NOT NULL,
  reviewer_initial text NOT NULL DEFAULT 'U',
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text text NOT NULL,
  review_date text NOT NULL,
  google_review_url text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;

-- Public can view active 4-5 star reviews
CREATE POLICY "Public can view high-rated active reviews"
  ON google_reviews
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND rating >= 4);

-- Admins can view all reviews
CREATE POLICY "Admins can view all reviews"
  ON google_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Admins can insert reviews
CREATE POLICY "Admins can insert reviews"
  ON google_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Admins can update reviews
CREATE POLICY "Admins can update reviews"
  ON google_reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Admins can delete reviews
CREATE POLICY "Admins can delete reviews"
  ON google_reviews
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'master')
    )
  );

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_google_reviews_active_rating
  ON google_reviews(is_active, rating, display_order);

-- Insert the existing review
INSERT INTO google_reviews (
  reviewer_name,
  reviewer_initial,
  rating,
  review_text,
  review_date,
  google_review_url,
  is_active,
  display_order
) VALUES (
  'Shawna Taleah',
  'S',
  5,
  'Rented a water slide from them yesterday, and will definitely be using them again. Super respectful, great communication.',
  '7 months ago',
  'https://www.google.com/maps/place/Bounce+Party+Club+LLC/@42.2751327,-83.3864424,17z/data=!4m8!3m7!1s0x883b45e123456789:0x1234567890abcdef!8m2!3d42.2751327!4d-83.3864424!9m1!1b1!16s%2Fg%2F11y1234567',
  true,
  1
) ON CONFLICT DO NOTHING;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_google_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS google_reviews_updated_at ON google_reviews;
CREATE TRIGGER google_reviews_updated_at
  BEFORE UPDATE ON google_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_google_reviews_updated_at();