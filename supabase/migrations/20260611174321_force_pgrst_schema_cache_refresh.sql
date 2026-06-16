-- Touch pricing_rules to force PostgREST schema cache refresh
COMMENT ON TABLE pricing_rules IS 'Pricing rules configuration - updated to include same_day_weekday_delivery_fee_cents';