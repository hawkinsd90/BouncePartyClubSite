import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getPricingRules(options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('pricing_rules')
        .select('*')
        .maybeSingle(),
    { context: 'getPricingRules', ...options }
  );
}

export async function updatePricingRules(updates: any, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('pricing_rules')
        .update(updates)
        .select()
        .maybeSingle(),
    { context: 'updatePricingRules', ...options }
  );
}
