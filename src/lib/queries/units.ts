import type { Database } from '../database.types';
import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getActiveUnits(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true }),
    { context: 'getActiveUnits', ...options }
  );
}

export interface InflatableUnitResolverConfig {
  id: string;
  active: boolean;
}

// Loads id+active for ALL units (no client-side active filter) so the E1
// resolver can distinguish known-active / known-inactive / unknown when rows
// are supplied to it. buildUnitMap preserves active=false.
//
// Current anonymous runtime RLS limitation: the public SELECT policy on
// `units` is `USING (active = true)`, so anon-key requests receive ONLY active
// rows. Inactive and unknown units are therefore indistinguishable in the live
// anonymous catalog today (both are absent). The resolver code is correct for
// the three-state case; if RLS is ever widened to expose inactive rows, the
// resolver works end-to-end without adapter changes. No RLS change is made in
// E2. No Admin-only fields are exposed.
export async function getInflatableUnitResolverConfigs(
  options?: QueryOptions
) {
  return executeQuery<InflatableUnitResolverConfig[]>(
    async () =>
      await supabase
        .from('units')
        .select('id, active')
        .order('name', { ascending: true }) as unknown as Promise<{
          data: InflatableUnitResolverConfig[] | null;
          error: unknown;
        }>,
    { context: 'getInflatableUnitResolverConfigs', ...options }
  );
}

export async function getUnitById(unitId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .select('*')
        .eq('id', unitId)
        .maybeSingle(),
    { context: 'getUnitById', ...options }
  );
}

export async function createUnit(unitData: Database['public']['Tables']['units']['Insert'], options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .insert(unitData)
        .select()
        .single(),
    { context: 'createUnit', ...options }
  );
}

export async function updateUnit(unitId: string, updates: Database['public']['Tables']['units']['Update'], options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .update(updates)
        .eq('id', unitId)
        .select()
        .single(),
    { context: 'updateUnit', ...options }
  );
}

export async function deleteUnit(unitId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .delete()
        .eq('id', unitId),
    { context: 'deleteUnit', ...options }
  );
}
