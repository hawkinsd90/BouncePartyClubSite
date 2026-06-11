ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS same_day_weekday_delivery_fee_cents integer DEFAULT 0 NOT NULL;
NOTIFY pgrst, 'reload schema';