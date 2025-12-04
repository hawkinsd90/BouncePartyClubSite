import { supabase } from './supabase';
import { calculateDrivingDistance } from './pricing';
import { HOME_BASE } from './constants';

export interface OrderItem {
  id?: string;
  unit_id: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  is_new?: boolean;
  units?: {
    name: string;
  };
}

export interface OrderDiscount {
  id?: string;
  name: string;
  amount_cents?: number;
  percentage?: number;
}

export interface OrderCustomFee {
  id?: string;
  name: string;
  amount_cents: number;
}

export interface OrderSummaryData {
  items: OrderItem[];
  discounts: OrderDiscount[];
  customFees: OrderCustomFee[];
  subtotal_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  generator_fee_cents: number;
  generator_qty: number;
  tax_cents: number;
  tip_cents?: number;
  total_cents: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  custom_deposit_cents?: number | null;
  pickup_preference: string;
  event_date: string;
  event_end_date?: string;
}

export interface OrderSummaryDisplay {
  items: Array<{
    name: string;
    mode: string;
    price: number;
    qty: number;
    lineTotal: number;
    isNew?: boolean;
  }>;
  fees: Array<{
    name: string;
    amount: number;
  }>;
  discounts: Array<{
    name: string;
    amount: number;
  }>;
  customFees: Array<{
    name: string;
    amount: number;
  }>;
  subtotal: number;
  totalFees: number;
  totalDiscounts: number;
  totalCustomFees: number;
  taxableAmount: number;
  tax: number;
  tip: number;
  total: number;
  depositDue: number;
  depositPaid: number;
  balanceDue: number;
  isMultiDay: boolean;
  pickupPreference: string;
}

export async function loadOrderSummary(orderId: string): Promise<OrderSummaryData | null> {
  try {
    const [orderRes, itemsRes, discountsRes, feesRes] = await Promise.all([
      supabase.from('orders').select('*, customers(*), addresses(*)').eq('id', orderId).single(),
      supabase.from('order_items').select('*, units(name)').eq('order_id', orderId),
      supabase.from('order_discounts').select('*').eq('order_id', orderId),
      supabase.from('order_custom_fees').select('*').eq('order_id', orderId),
    ]);

    if (!orderRes.data) return null;

    const order = orderRes.data;
    let travelMiles = parseFloat(order.travel_total_miles) || 0;

    // If travel miles not saved and we have travel fee, calculate it in real-time
    if (travelMiles === 0 && order.travel_fee_cents > 0 && order.addresses) {
      try {
        const lat = parseFloat(order.addresses.lat);
        const lng = parseFloat(order.addresses.lng);
        if (lat && lng) {
          travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);
          // Optionally save it for next time (fire and forget, don't await)
          if (travelMiles > 0) {
            supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', orderId);
          }
        }
      } catch (error) {
        console.error('Error calculating travel distance on-the-fly:', error);
      }
    }

    return {
      items: (itemsRes.data || []).map(item => ({
        ...item,
        units: item.units || undefined,
      })) as OrderItem[],
      discounts: discountsRes.data || [],
      customFees: feesRes.data || [],
      subtotal_cents: order.subtotal_cents,
      travel_fee_cents: order.travel_fee_cents || 0,
      travel_total_miles: travelMiles,
      surface_fee_cents: order.surface_fee_cents || 0,
      same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
      generator_fee_cents: order.generator_fee_cents || 0,
      generator_qty: order.generator_qty || 0,
      tax_cents: order.tax_cents || 0,
      tip_cents: order.tip_cents || 0,
      total_cents: calculateTotalFromOrder(order, discountsRes.data || [], feesRes.data || []),
      deposit_due_cents: order.deposit_due_cents,
      deposit_paid_cents: order.deposit_paid_cents || 0,
      balance_due_cents: order.balance_due_cents,
      custom_deposit_cents: order.custom_deposit_cents,
      pickup_preference: order.pickup_preference,
      event_date: order.event_date,
      event_end_date: order.event_end_date,
    };
  } catch (error) {
    console.error('Error loading order summary:', error);
    return null;
  }
}

function calculateTotalFromOrder(order: any, discounts: OrderDiscount[], customFees: OrderCustomFee[]): number {
  const subtotal = order.subtotal_cents || 0;
  const travelFee = order.travel_fee_cents || 0;
  const surfaceFee = order.surface_fee_cents || 0;
  const sameDayFee = order.same_day_pickup_fee_cents || 0;
  const generatorFee = order.generator_fee_cents || 0;
  const tax = order.tax_cents || 0;
  const tip = order.tip_cents || 0;

  const totalFees = travelFee + surfaceFee + sameDayFee + generatorFee;
  const totalCustomFees = customFees.reduce((sum, fee) => sum + (fee.amount_cents || 0), 0);

  const discountTotal = discounts.reduce((sum, discount) => {
    if (discount.percentage) {
      return sum + Math.round(subtotal * (discount.percentage / 100));
    }
    return sum + (discount.amount_cents || 0);
  }, 0);

  return subtotal + totalFees + totalCustomFees - discountTotal + tax + tip;
}

export function formatOrderSummary(data: OrderSummaryData): OrderSummaryDisplay {
  const items = data.items.map(item => ({
    name: item.units?.name || 'Unknown Item',
    mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
    price: item.unit_price_cents,
    qty: item.qty,
    lineTotal: item.unit_price_cents * item.qty,
    isNew: item.is_new || false,
  }));

  const fees: Array<{ name: string; amount: number }> = [];

  if (data.travel_fee_cents > 0) {
    // Build travel fee display name with total miles
    const travelFeeName = data.travel_total_miles > 0
      ? `Travel Fee (${data.travel_total_miles.toFixed(1)} mi)`
      : 'Travel Fee';
    fees.push({ name: travelFeeName, amount: data.travel_fee_cents });
  }

  if (data.surface_fee_cents > 0) {
    fees.push({ name: 'Surface Fee (Sandbags)', amount: data.surface_fee_cents });
  }

  if (data.same_day_pickup_fee_cents > 0) {
    fees.push({ name: 'Same-Day Pickup Fee', amount: data.same_day_pickup_fee_cents });
  }

  if (data.generator_fee_cents > 0) {
    const generatorLabel = data.generator_qty > 1
      ? `Generator (${data.generator_qty}x)`
      : 'Generator';
    fees.push({ name: generatorLabel, amount: data.generator_fee_cents });
  }

  const discounts = data.discounts.map(discount => {
    let amount = discount.amount_cents || 0;
    if (discount.percentage) {
      amount = Math.round(data.subtotal_cents * (discount.percentage / 100));
    }
    return {
      name: discount.name,
      amount: amount,
    };
  });

  const customFees = data.customFees.map(fee => ({
    name: fee.name,
    amount: fee.amount_cents,
  }));

  const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const totalDiscounts = discounts.reduce((sum, d) => sum + d.amount, 0);
  const totalCustomFees = customFees.reduce((sum, f) => sum + f.amount, 0);

  const taxableAmount = data.subtotal_cents + totalFees + totalCustomFees - totalDiscounts;
  const tip = data.tip_cents || 0;
  const total = taxableAmount + data.tax_cents + tip;

  const isMultiDay = data.event_end_date && data.event_end_date !== data.event_date;

  return {
    items,
    fees,
    discounts,
    customFees,
    subtotal: data.subtotal_cents,
    totalFees,
    totalDiscounts,
    totalCustomFees,
    taxableAmount,
    tax: data.tax_cents,
    tip,
    total,
    depositDue: data.deposit_due_cents,
    depositPaid: data.deposit_paid_cents,
    balanceDue: data.balance_due_cents,
    isMultiDay: !!isMultiDay,
    pickupPreference: data.pickup_preference,
  };
}
