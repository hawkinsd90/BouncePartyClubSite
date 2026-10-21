-- WP-14: the days of the week on which the same-day delivery fee applies become a pricing rule.
--
-- Until now the fee applied when the event date was today (America/Detroit) and the weekday was Monday to Friday, hard-coded in
-- application code. The admin chooses the days (0 = Sunday ... 6 = Saturday). The default reproduces the current behavior exactly
-- (Monday to Friday), so existing rows price as before. An empty list means the fee is never charged. Additive and idempotent.

ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS same_day_delivery_fee_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[];

ALTER TABLE public.pricing_rules
  DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;

ALTER TABLE public.pricing_rules
  ADD CONSTRAINT pricing_rules_same_day_delivery_fee_days_valid
  CHECK (
    same_day_delivery_fee_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
    AND array_position(same_day_delivery_fee_days, NULL) IS NULL
  );

COMMENT ON COLUMN public.pricing_rules.same_day_delivery_fee_days IS
  'Days of the week (0 = Sunday ... 6 = Saturday) on which a same-day delivery fee applies when the event date is today in America/Detroit. Default Monday to Friday. Empty = never charged.';
