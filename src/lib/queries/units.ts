import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getAllUnits(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .select('*')
        .order('sort_order', { ascending: true }),
    { context: 'getAllUnits', ...options }
  );
}

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

export async function getUnitsByType(type: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('units')
        .select('*')
        .eq('type', type)
        .order('sort_order', { ascending: true }),
    { context: 'getUnitsByType', ...options }
  );
}

// Legacy alias for backwards compatibility
export async function getUnitsByCategory(category: string, options?: QueryOptions) {
  return getUnitsByType(category, options);
}

export async function createUnit(unitData: any, options?: QueryOptions) {
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

export async function updateUnit(unitId: string, updates: any, options?: QueryOptions) {
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

export async function checkUnitAvailability(
  unitId: string,
  startDate: string,
  endDate: string,
  excludeOrderId?: string,
  options?: QueryOptions
) {
  return executeQuery(
    async () => {
      const { data, error } = await supabase.rpc('check_unit_availability', {
        p_unit_ids: [unitId],
        p_start_date: startDate,
        p_end_date: endDate,
        p_exclude_order_id: excludeOrderId || null,
      } as any);

      if (error) return { data: null, error };

      const unitAvailability = Array.isArray(data) ? data[0] : null;
      return {
        data: unitAvailability?.is_available || false,
        error: null,
      };
    },
    { context: 'checkUnitAvailability', ...options }
  );
}

export async function checkMultipleUnitsAvailability(
  unitIds: string[],
  startDate: string,
  endDate: string,
  excludeOrderId?: string,
  options?: QueryOptions
) {
  return executeQuery(
    async () =>
      await supabase.rpc('check_unit_availability', {
        p_unit_ids: unitIds,
        p_start_date: startDate,
        p_end_date: endDate,
        p_exclude_order_id: excludeOrderId || null,
      } as any),
    { context: 'checkMultipleUnitsAvailability', ...options }
  );
}
