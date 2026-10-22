import { useState, useEffect } from 'react';
import { getAllCustomers, getActiveUnits, getPricingRules } from '../../lib/queries';
import type { PricingRules } from '../../lib/pricing';

// The pricing_rules row as this mapper reads it: the same names and types as PricingRules, except the three JSON columns, which the
// mapper narrows itself below.
type PricingRulesRow = Omit<PricingRules, 'included_city_list_json' | 'zone_overrides_json' | 'same_day_matrix_json'> & {
  included_city_list_json: unknown;
  zone_overrides_json: unknown;
  same_day_matrix_json: unknown;
};
type CustomerRow = NonNullable<Awaited<ReturnType<typeof getAllCustomers>>['data']>[number];

export function useInvoiceData() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [customersRes, unitsRes, rulesRes] = await Promise.all([
        getAllCustomers(),
        getActiveUnits(),
        getPricingRules(),
      ]);

      if (customersRes.data) setCustomers(customersRes.data);
      if (unitsRes.data) setUnits(unitsRes.data);
      if (rulesRes.data) {
        const r = rulesRes.data as unknown as PricingRulesRow;
        setPricingRules({
          base_radius_miles: r.base_radius_miles,
          included_city_list_json: r.included_city_list_json as string[],
          per_mile_after_base_cents: r.per_mile_after_base_cents,
          zone_overrides_json: r.zone_overrides_json as Array<{ zip: string; flat_cents: number }>,
          surface_sandbag_fee_cents: r.surface_sandbag_fee_cents,
          residential_multiplier: r.residential_multiplier,
          commercial_multiplier: r.commercial_multiplier,
          same_day_matrix_json: r.same_day_matrix_json as Array<{
            units: number;
            generator: boolean;
            subtotal_ge_cents: number;
            fee_cents: number;
          }>,
          overnight_holiday_only: r.overnight_holiday_only,
          extra_day_pct: r.extra_day_pct,
          generator_price_cents: r.generator_price_cents,
          deposit_per_unit_cents: r.deposit_per_unit_cents,
          same_day_pickup_fee_cents: r.same_day_pickup_fee_cents,
          generator_fee_single_cents: r.generator_fee_single_cents,
          generator_fee_multiple_cents: r.generator_fee_multiple_cents,
          apply_taxes_by_default: r.apply_taxes_by_default,
          same_day_weekday_delivery_fee_cents: r.same_day_weekday_delivery_fee_cents,
          ee_only_deposit_base_threshold_cents: r.ee_only_deposit_base_threshold_cents,
          ee_only_deposit_base_cents: r.ee_only_deposit_base_cents,
          ee_only_deposit_subtotal_step_cents: r.ee_only_deposit_subtotal_step_cents,
          ee_only_deposit_step_cents: r.ee_only_deposit_step_cents,
          // Both were missing from this mapper: the invoice preview then used the hard-coded setup minimum and the default same-day days.
          event_essentials_setup_minimum_cents: r.event_essentials_setup_minimum_cents,
          same_day_delivery_fee_days: r.same_day_delivery_fee_days,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function addCustomer(customer: CustomerRow) {
    setCustomers([...customers, customer]);
  }

  return {
    customers,
    units,
    pricingRules,
    loading,
    addCustomer,
  };
}
