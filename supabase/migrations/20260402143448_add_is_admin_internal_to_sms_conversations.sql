/*
  # Add is_admin_internal flag to sms_conversations

  ## Summary
  Adds an `is_admin_internal` boolean column to `sms_conversations` so that
  SMS messages sent to the admin phone (e.g., "NEW BOOKING REQUEST!" alerts)
  can be flagged and excluded from the customer-facing conversation thread.

  ## Problem
  The send-sms-notification edge function logs ALL outbound SMS to
  sms_conversations with the order_id. Admin-notification messages (sent to the
  admin phone, not the customer) were therefore appearing in the order's SMS
  conversation view, creating confusion.

  ## Changes
  - `sms_conversations.is_admin_internal` (boolean, default false)
    - true  = admin-only message, hide from customer-facing conversation thread
    - false = part of the customer conversation (default, existing behaviour)

  ## Notes
  - Existing rows default to false (part of the customer thread), which is safe
  - The edge function will set this to true for admin-template messages
  - The conversation query in usePendingOrderData filters out is_admin_internal=true
*/

ALTER TABLE sms_conversations ADD COLUMN IF NOT EXISTS is_admin_internal boolean DEFAULT false;
