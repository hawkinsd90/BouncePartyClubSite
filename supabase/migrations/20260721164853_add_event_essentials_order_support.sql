/*
# Stage E4: Event Essentials Order Persistence Support

1. New Columns
- `orders.event_essentials_subtotal_cents` (integer, nullable, default 0)
  Stores the Event Essentials portion of the combined equipment subtotal.
  Existing orders have NULL/0 — inflatable-only behavior is preserved.
- `order_items.wet_or_dry` changed from NOT NULL to nullable
  so Event Essential product/package rows can omit the inflatable-only
  wet_or_dry field. Historical inflatable rows already have valid values.

2. Rationale
- `order_items` already has nullable product_id, bundle_id, item_name,
  component_snapshot, pricing_context columns plus a
  num_nonnulls(unit_id, product_id, bundle_id) = 1 check constraint.
- The only blocker was wet_or_dry NOT NULL preventing EE inserts.
- orders has no total_cents column — totals are derived by
  calculateTotalFromOrder(). Adding event_essentials_subtotal_cents
  lets that function include EE exactly once.

3. Security
- No RLS policy changes.
- No new tables.
- All existing policies remain unchanged.
- Historical rows remain valid (nullable column, default 0).
*/

-- Add event_essentials_subtotal_cents to orders (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'event_essentials_subtotal_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN event_essentials_subtotal_cents integer DEFAULT 0;
  END IF;
END $$;

-- Make order_items.wet_or_dry nullable (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_items'
      AND column_name = 'wet_or_dry'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE order_items ALTER COLUMN wet_or_dry DROP NOT NULL;
  END IF;
END $$;
