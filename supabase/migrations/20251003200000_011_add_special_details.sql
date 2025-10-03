/*
  # Add Special Details to Orders

  1. Orders Table Updates
    - Add special_details text field for customer notes
    - Examples: "It's a birthday party", "Need setup by 2pm", "Call before arriving"

  2. Notes
    - Field is optional (nullable)
    - Visible to admin and crew for event planning
    - Saved with order and displayed throughout workflow
*/

-- Add special_details column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_details text;

-- Add comment for documentation
COMMENT ON COLUMN orders.special_details IS 'Customer notes about the event (birthday, special needs, setup instructions, etc.)';
