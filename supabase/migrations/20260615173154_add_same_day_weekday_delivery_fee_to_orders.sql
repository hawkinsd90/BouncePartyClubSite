ALTER TABLE orders ADD COLUMN IF NOT EXISTS same_day_weekday_delivery_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS same_day_weekday_delivery_fee_waived boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS same_day_weekday_delivery_fee_waive_reason text;