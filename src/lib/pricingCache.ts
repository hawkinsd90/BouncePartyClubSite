import { supabase } from './supabase';

interface PricingRules {
  deposit_percentage: number;
}

let cachedPricingRules: PricingRules | null = null;
let fetchPromise: Promise<PricingRules | null> | null = null;

export async function getDepositPercentage(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.deposit_percentage;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.deposit_percentage || 0.25; // Default 25%
  }

  // Start a new fetch
  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('deposit_percentage')
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
  return result?.deposit_percentage || 0.25; // Default 25%
}

// Legacy function for backward compatibility
export async function getDepositAmount(): Promise<number> {
  const percentage = await getDepositPercentage();
  // This is now a placeholder - callers should use getDepositPercentage instead
  return Math.round(5000 * percentage);
}

export function clearPricingCache() {
  cachedPricingRules = null;
  fetchPromise = null;
}
