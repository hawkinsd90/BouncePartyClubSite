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
        setPricingRules({
          base_radius_miles: rulesRes.data.base_radius_miles,
          included_city_list_json: rulesRes.data.included_city_list_json as string[],
          per_mile_after_base_cents: rulesRes.data.per_mile_after_base_cents,
          zone_overrides_json: rulesRes.data.zone_overrides_json as Array<{ zip: string; flat_cents: number }>,
          surface_sandbag_fee_cents: rulesRes.data.surface_sandbag_fee_cents,
          residential_multiplier: rulesRes.data.residential_multiplier,
          commercial_multiplier: rulesRes.data.commercial_multiplier,
          same_day_matrix_json: rulesRes.data.same_day_matrix_json as Array<{
            units: number;
            generator: boolean;
            subtotal_ge_cents: number;
            fee_cents: number;
          }>,
          overnight_holiday_only: rulesRes.data.overnight_holiday_only,
          extra_day_pct: rulesRes.data.extra_day_pct,
          generator_price_cents: rulesRes.data.generator_price_cents,
          deposit_per_unit_cents: rulesRes.data.deposit_per_unit_cents,
          same_day_pickup_fee_cents: rulesRes.data.same_day_pickup_fee_cents,
          generator_fee_single_cents: rulesRes.data.generator_fee_single_cents,
          generator_fee_multiple_cents: rulesRes.data.generator_fee_multiple_cents,
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
