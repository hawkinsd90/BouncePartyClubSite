import type { Database } from '../database.types';
import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getPricingRules(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('pricing_rules')
        .select('*')
        .maybeSingle(),
    { context: 'getPricingRules', ...options }
  );
}

export async function updatePricingRules(updates: Database['public']['Tables']['pricing_rules']['Update'], options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('pricing_rules')
        .update(updates)
        .select()
        .maybeSingle(),
    { context: 'updatePricingRules', ...options }
  );
}
