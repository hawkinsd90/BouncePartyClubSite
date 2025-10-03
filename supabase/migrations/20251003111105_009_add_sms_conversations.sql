/*
  # SMS Conversations Table

  1. New Tables
    - `sms_conversations`
      - `id` (uuid, primary key)
      - `order_id` (uuid, foreign key to orders) - Links SMS to a specific booking
      - `from_phone` (text) - Phone number that sent the message
      - `to_phone` (text) - Phone number that received the message
      - `message_body` (text) - Content of the SMS
      - `direction` (text) - 'inbound' or 'outbound'
      - `twilio_message_sid` (text) - Twilio's unique message ID
      - `status` (text) - Message status (queued, sent, delivered, failed, received)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `sms_conversations` table
    - Add policies for authenticated admin users only

  3. Indexes
    - Index on order_id for fast lookup
    - Index on from_phone for customer lookup
    - Index on created_at for chronological ordering
*/

CREATE TABLE IF NOT EXISTS sms_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  from_phone text NOT NULL,
  to_phone text NOT NULL,
  message_body text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  twilio_message_sid text,
  status text DEFAULT 'received',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users can read SMS conversations"
  ON sms_conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

CREATE POLICY "Admin users can insert SMS conversations"
  ON sms_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'ADMIN'
    )
  );

-- Allow the edge function to insert (using service role key)
CREATE POLICY "Service role can insert SMS conversations"
  ON sms_conversations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sms_conversations_order_id ON sms_conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_from_phone ON sms_conversations(from_phone);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_created_at ON sms_conversations(created_at DESC);