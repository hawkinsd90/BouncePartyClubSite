/*
  # Add Lifecycle Notification Flags

  Adds two tracking columns to the orders table to prevent duplicate admin alerts
  for distinct lifecycle events:

  1. `pending_review_admin_alerted` (boolean, default false)
     - Set to true once admin has been notified that a booking REQUEST was received
     - Guards the enterPendingReview admin SMS+email

  2. `confirmed_admin_alerted` (boolean, default false)
     - Set to true once admin has been notified that a booking was CONFIRMED
     - Guards the enterConfirmed admin SMS+email
     - Separate from pending_review_admin_alerted to avoid the overloaded
       booking_confirmation_sent flag problem

  The existing `booking_confirmation_sent` flag is left untouched for backwards
  compatibility — it tracks customer-facing notifications sent from the
  standard checkout path.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'pending_review_admin_alerted'
  ) THEN
    ALTER TABLE orders ADD COLUMN pending_review_admin_alerted boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'confirmed_admin_alerted'
  ) THEN
    ALTER TABLE orders ADD COLUMN confirmed_admin_alerted boolean NOT NULL DEFAULT false;
  END IF;
END $$;
