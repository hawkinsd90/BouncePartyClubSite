import { supabase } from './supabase';

export interface AvailabilityCheck {
  unitId: string;
  eventStartDate: string;
  eventEndDate: string;
  excludeOrderId?: string;
}

export interface UnitAvailability {
  unitId: string;
  isAvailable: boolean;
  conflictingOrders?: {
    orderId: string;
    eventStartDate: string;
    eventEndDate: string;
    status: string;
  }[];
}

const BLOCKED_STATUSES = ['pending_review', 'approved', 'confirmed', 'in_progress', 'completed'];

export async function checkUnitAvailability(
  check: AvailabilityCheck
): Promise<UnitAvailability> {
  const { unitId, eventStartDate, eventEndDate, excludeOrderId } = check;

  let query = supabase
    .from('order_items')
    .select(`
      order_id,
      orders!inner(
        id,
        start_date,
        end_date,
        status
      )
    `)
    .eq('unit_id', unitId)
    .in('orders.status', BLOCKED_STATUSES);

  if (excludeOrderId) {
    query = query.neq('order_id', excludeOrderId);
  }

  const { data: orderItems, error } = await query;

  if (error) {
    console.error('Error checking availability:', error);
    return {
      unitId,
      isAvailable: false,
      conflictingOrders: [],
    };
  }

  const conflictingOrders = (orderItems || [])
    .filter((item: any) => {
      const order = item.orders;
      if (!order) return false;

      const orderStart = new Date(order.start_date);
      const orderEnd = new Date(order.end_date);
      const checkStart = new Date(eventStartDate);
      const checkEnd = new Date(eventEndDate);

      const conflicts = (
        (checkStart >= orderStart && checkStart <= orderEnd) ||
        (checkEnd >= orderStart && checkEnd <= orderEnd) ||
        (checkStart <= orderStart && checkEnd >= orderEnd)
      );

      return conflicts;
    })
    .map((item: any) => ({
      orderId: item.orders.id,
      eventStartDate: item.orders.start_date,
      eventEndDate: item.orders.end_date,
      status: item.orders.status,
    }));

  return {
    unitId,
    isAvailable: conflictingOrders.length === 0,
    conflictingOrders: conflictingOrders.length > 0 ? conflictingOrders : undefined,
  };
}

export async function checkMultipleUnitsAvailability(
  checks: AvailabilityCheck[]
): Promise<UnitAvailability[]> {
  const results = await Promise.all(
    checks.map(check => checkUnitAvailability(check))
  );
  return results;
}

export async function getUnavailableDatesForUnit(
  unitId: string,
  startDate?: string,
  endDate?: string
): Promise<{ start: string; end: string; status: string }[]> {
  let query = supabase
    .from('order_items')
    .select(`
      orders!inner(
        start_date,
        end_date,
        status
      )
    `)
    .eq('unit_id', unitId)
    .in('orders.status', BLOCKED_STATUSES);

  if (startDate) {
    query = query.gte('orders.end_date', startDate);
  }

  if (endDate) {
    query = query.lte('orders.start_date', endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching unavailable dates:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    start: item.orders.start_date,
    end: item.orders.end_date,
    status: item.orders.status,
  }));
}
