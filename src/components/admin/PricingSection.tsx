import { PricingRulesTab } from './PricingRulesTab';

interface PricingRules {
  id: string;
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  surface_sandbag_fee_cents: number;
  deposit_per_unit_cents?: number;
  included_cities?: string[] | null;
  generator_fee_single_cents?: number;
  generator_fee_multiple_cents?: number;
  same_day_pickup_fee_cents?: number;
  apply_taxes_by_default?: boolean;
}

interface PricingSectionProps {
  pricingRules: PricingRules;
}

export function PricingSection({ pricingRules: initialRules }: PricingSectionProps) {
  return <PricingRulesTab pricingRules={initialRules} />;
}
