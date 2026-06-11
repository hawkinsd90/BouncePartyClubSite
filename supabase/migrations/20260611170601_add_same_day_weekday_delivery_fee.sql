DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'same_day_weekday_delivery_fee_cents'
  ) THEN
    ALTER TABLE pricing_rules ADD COLUMN same_day_weekday_delivery_fee_cents integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'same_day_weekday_delivery_fee_cents'
  ) THEN
    ALTER TABLE orders ADD COLUMN same_day_weekday_delivery_fee_cents integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'same_day_weekday_delivery_fee_waived'
  ) THEN
    ALTER TABLE orders ADD COLUMN same_day_weekday_delivery_fee_waived boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'same_day_weekday_delivery_fee_waive_reason'
  ) THEN
    ALTER TABLE orders ADD COLUMN same_day_weekday_delivery_fee_waive_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'same_day_weekday_delivery_fee_cents'
  ) THEN
    ALTER TABLE invoices ADD COLUMN same_day_weekday_delivery_fee_cents integer DEFAULT 0;
  END IF;
END $$;