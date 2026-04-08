import { supabase } from './supabase';

interface PricingRules {
  deposit_percentage: number | null;
  deposit_per_unit_cents: number | null;
  generator_fee_single_cents: number | null;
  generator_fee_multiple_cents: number | null;
}

let cachedPricingRules: PricingRules | null = null;
let fetchPromise: Promise<PricingRules | null> | null = null;

async function fetchPricingRules(): Promise<PricingRules | null> {
  try {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('deposit_percentage, deposit_per_unit_cents, generator_fee_single_cents, generator_fee_multiple_cents')
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
}

export async function getDepositPercentage(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.deposit_percentage ?? 0.25;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.deposit_percentage || 0.25; // Default 25%
  }

  // Start a new fetch
  fetchPromise = fetchPricingRules();

  const result = await fetchPromise;
  return result?.deposit_percentage || 0.25; // Default 25%
}

// Get deposit amount per unit in cents
export async function getDepositAmount(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.deposit_per_unit_cents || 5000;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.deposit_per_unit_cents || 5000;
  }

  // Start a new fetch
  fetchPromise = fetchPricingRules();

  const result = await fetchPromise;
  return result?.deposit_per_unit_cents || 5000;
}

// Get generator fee for single generator in cents
export async function getGeneratorFeeSingle(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.generator_fee_single_cents || 9500;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.generator_fee_single_cents || 9500;
  }

  // Start a new fetch
  fetchPromise = fetchPricingRules();

  const result = await fetchPromise;
  return result?.generator_fee_single_cents || 9500;
}

export function clearPricingCache() {
  cachedPricingRules = null;
  fetchPromise = null;
}
