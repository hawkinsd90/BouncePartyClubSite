import { useState, useEffect } from 'react';
import { getAllCustomers, getActiveUnits, getPricingRules } from '../lib/queries';
import type { PricingRules } from '../lib/pricing';

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
        const r = rulesRes.data as any;
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
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function addCustomer(customer: any) {
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
