/*
  # Phase 2 — Address-Saved Lot Photos

  ## Summary
  Enables admins to save lot photos from a specific order to the order's event address,
  so future orders at the same address can show historical setup context automatically.

  ## New Tables

  ### `address_lot_pictures`
  Stores lot photos that have been explicitly saved to an address by an admin.
  - `id` — primary key
  - `address_id` — FK to addresses (cascade delete)
  - `file_path` — storage path in the lot-pictures bucket
  - `file_name` — display name
  - `notes` — optional notes copied from source lot picture
  - `saved_from_order_id` — FK to the order this photo was originally uploaded for (set null on order delete)
  - `saved_from_order_lot_picture_id` — FK to the original order_lot_pictures row (set null on row delete)
  - `saved_by` — FK to auth.users recording which admin saved it
  - `created_at` — timestamp

  ## Modified Tables

  ### `order_lot_pictures`
  - Adds `address_id` column (uuid, nullable FK to addresses) to track which address a lot picture
    has been saved to. This allows the Media Library hook to mark photos as already-saved.

  ## Duplicate Prevention
  - Unique index on `(address_id, file_path)` prevents the same physical file from being saved
    to the same address more than once.

  ## Security
  - RLS enabled on `address_lot_pictures`.
  - Admin and master roles can SELECT, INSERT, DELETE.
  - No anon access at all — these are private operational admin photos.
  - Uses the existing `get_user_role(auth.uid())` function for role checks.
*/

-- 1. Add address_id to order_lot_pictures if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_lot_pictures' AND column_name = 'address_id'
  ) THEN
    ALTER TABLE order_lot_pictures
      ADD COLUMN address_id uuid REFERENCES addresses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Create address_lot_pictures table
CREATE TABLE IF NOT EXISTS address_lot_pictures (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id                      uuid NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  file_path                       text NOT NULL,
  file_name                       text NOT NULL,
  notes                           text,
  saved_from_order_id             uuid REFERENCES orders(id) ON DELETE SET NULL,
  saved_from_order_lot_picture_id uuid REFERENCES order_lot_pictures(id) ON DELETE SET NULL,
  saved_by                        uuid REFERENCES auth.users(id),
  created_at                      timestamptz DEFAULT now()
);

-- 3. Unique index to prevent duplicate saves of the same file to the same address
CREATE UNIQUE INDEX IF NOT EXISTS address_lot_pictures_address_file_path_key
  ON address_lot_pictures (address_id, file_path);

-- 4. Index for fast lookups by address
CREATE INDEX IF NOT EXISTS address_lot_pictures_address_id_idx
  ON address_lot_pictures (address_id);

-- 5. Enable RLS
ALTER TABLE address_lot_pictures ENABLE ROW LEVEL SECURITY;

-- 6. SELECT — admin and master only
CREATE POLICY "Admin and master can view address lot pictures"
  ON address_lot_pictures
  FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'master')
  );

-- 7. INSERT — admin and master only
CREATE POLICY "Admin and master can save address lot pictures"
  ON address_lot_pictures
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'master')
  );

-- 8. DELETE — admin and master only (Phase 4 will build a full delete flow)
CREATE POLICY "Admin and master can delete address lot pictures"
  ON address_lot_pictures
  FOR DELETE
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'master')
  );
