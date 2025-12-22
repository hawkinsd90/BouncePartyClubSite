import { supabase } from './supabase';

interface PricingRules {
  deposit_per_unit_cents: number;
}

let cachedPricingRules: PricingRules | null = null;
let fetchPromise: Promise<PricingRules | null> | null = null;

export async function getDepositAmount(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.deposit_per_unit_cents;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.deposit_per_unit_cents || 5000;
  }

  // Start a new fetch
  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('deposit_per_unit_cents')
        .maybeSingle();

      if (error) throw error;

      cachedPricingRules = data;
      return data;
    } catch (error) {
      console.error('Failed to fetch pricing rules:', error);
      return null;
    } finally {
      fetchPromise = null;
    }
  })();

  const result = await fetchPromise;
  return result?.deposit_per_unit_cents || 5000;
}

export function clearPricingCache() {
  cachedPricingRules = null;
  fetchPromise = null;
}
