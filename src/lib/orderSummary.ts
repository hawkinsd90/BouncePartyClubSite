import { supabase } from './supabase';
import { calculateDrivingDistance } from './pricing';
import { HOME_BASE } from './constants';
import { buildOrderSummaryDisplay } from './orderSummaryHelpers';

async function estimateDistanceFromFee(travelFeeCents: number): Promise<number> {
  try {
    console.log('[estimateDistanceFromFee] Estimating distance from fee:', travelFeeCents / 100);

    const { data: pricingData } = await supabase
      .from('pricing_rules')
      .select('base_radius_miles, per_mile_after_base_cents')
      .single();

    if (!pricingData) {
      console.warn('[estimateDistanceFromFee] No pricing rules found, cannot estimate');
      return 0;
    }

    const baseRadius = parseFloat(pricingData.base_radius_miles?.toString() || '10');
    const perMileCents = pricingData.per_mile_after_base_cents || 250;

    // Formula: fee = (distance - baseRadius) * perMileCents
    // Therefore: distance = (fee / perMileCents) + baseRadius
    const chargeableMiles = travelFeeCents / perMileCents;
    const estimatedDistance = baseRadius + chargeableMiles;

    console.log('[estimateDistanceFromFee] Estimated distance:', {
      baseRadius,
      perMileCents,
      chargeableMiles: chargeableMiles.toFixed(2),
      estimatedDistance: estimatedDistance.toFixed(2),
    });

    return estimatedDistance;
  } catch (error) {
    console.error('[estimateDistanceFromFee] Error estimating distance:', error);
    return 0;
  }
}

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
  travel_fee_waived?: boolean;
  surface_fee_waived?: boolean;
  same_day_pickup_fee_waived?: boolean;
  generator_fee_waived?: boolean;
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

async function calculateOriginalFees(order: any, discounts: OrderDiscount[], customFees: OrderCustomFee[]): Promise<{
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  generator_fee_cents: number;
  tax_cents: number;
}> {
  const { data: pricingData } = await supabase
    .from('pricing_rules')
    .select('*')
    .single();

  if (!pricingData) {
    return {
      travel_fee_cents: 0,
      surface_fee_cents: 0,
      same_day_pickup_fee_cents: 0,
      generator_fee_cents: 0,
      tax_cents: 0,
    };
  }

  let travelFeeCents = order.travel_fee_cents || 0;
  if (order.travel_fee_waived && travelFeeCents === 0 && order.travel_total_miles > 0) {
    const baseRadius = parseFloat(pricingData.base_radius_miles?.toString() || '10');
    const perMileCents = pricingData.per_mile_after_base_cents || 250;
    const chargeableMiles = Math.max(0, order.travel_total_miles - baseRadius);
    travelFeeCents = Math.round(chargeableMiles * perMileCents);
  }

  let surfaceFeeCents = order.surface_fee_cents || 0;
  if (order.surface_fee_waived && surfaceFeeCents === 0 && order.surface === 'concrete') {
    surfaceFeeCents = pricingData.surface_sandbag_fee_cents || 3500;
  }

  let sameDayPickupFeeCents = order.same_day_pickup_fee_cents || 0;
  if (order.same_day_pickup_fee_waived && sameDayPickupFeeCents === 0 && order.pickup_preference === 'same_day') {
    sameDayPickupFeeCents = pricingData.same_day_pickup_fee_cents || 10500;
  }

  let generatorFeeCents = order.generator_fee_cents || 0;
  if (order.generator_fee_waived && generatorFeeCents === 0 && (order.generator_qty || 0) > 0) {
    const perGeneratorCents = pricingData.generator_price_cents || 9500;
    generatorFeeCents = perGeneratorCents * (order.generator_qty || 0);
  }

  let taxCents = order.tax_cents || 0;
  if (order.tax_waived && taxCents === 0) {
    const subtotal = order.subtotal_cents || 0;
    const discountTotal = discounts.reduce((sum, discount) => {
      if (discount.percentage) {
        return sum + Math.round(subtotal * (discount.percentage / 100));
      }
      return sum + (discount.amount_cents || 0);
    }, 0);
    const totalCustomFees = customFees.reduce((sum, fee) => sum + (fee.amount_cents || 0), 0);
    // Same-day pickup fee is NOT taxable (applied after tax)
    const taxableAmount = subtotal + travelFeeCents + surfaceFeeCents + generatorFeeCents + totalCustomFees - discountTotal;
    taxCents = Math.round(taxableAmount * 0.06);
  }

  return {
    travel_fee_cents: travelFeeCents,
    surface_fee_cents: surfaceFeeCents,
    same_day_pickup_fee_cents: sameDayPickupFeeCents,
    generator_fee_cents: generatorFeeCents,
    tax_cents: taxCents,
  };
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
    let travelMiles = order.travel_total_miles || 0;

    // If travel miles not saved and we have travel fee, calculate it in real-time
    if (travelMiles === 0 && order.travel_fee_cents > 0) {
      // Strategy 1: Use stored travel_per_mile_cents if available
      if (order.travel_per_mile_cents && order.travel_per_mile_cents > 0) {
        console.log('[OrderSummary] Estimating distance from stored per-mile rate');
        const { data: pricingData } = await supabase
          .from('pricing_rules')
          .select('base_radius_miles')
          .single();

        const baseRadius = parseFloat(pricingData?.base_radius_miles?.toString() || '10');
        const chargeableMiles = order.travel_fee_cents / order.travel_per_mile_cents;
        travelMiles = baseRadius + chargeableMiles;

        console.log('[OrderSummary] Estimated distance:', {
          baseRadius,
          chargeableMiles: chargeableMiles.toFixed(2),
          totalMiles: travelMiles.toFixed(2),
        });
      }
      // Strategy 2: Try to calculate from coordinates
      else if (order.addresses) {
        console.log('[OrderSummary] Attempting real-time travel distance calculation', {
          orderId,
          travelFeeCents: order.travel_fee_cents,
          hasAddresses: !!order.addresses,
          addressData: order.addresses,
        });

        try {
          const addr = order.addresses as any;
          const lat = parseFloat(addr.lat);
          const lng = parseFloat(addr.lng);

          console.log('[OrderSummary] Parsed coordinates:', { lat, lng, isValid: !!(lat && lng) });

          if (lat && lng) {
            console.log('[OrderSummary] Calling calculateDrivingDistance...');
            travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);
            console.log('[OrderSummary] Distance calculation result:', travelMiles, 'miles');

            // Optionally save it for next time (fire and forget, don't await)
            if (travelMiles > 0) {
              console.log('[OrderSummary] Saving calculated distance to database');
              supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', orderId);
            } else {
              console.warn('[OrderSummary] Calculated distance was 0 or invalid, not saving');
            }
          } else {
            console.warn('[OrderSummary] Invalid coordinates - lat or lng is falsy', { lat, lng });
            // Strategy 3: Estimate from current pricing rules
            travelMiles = await estimateDistanceFromFee(order.travel_fee_cents);
          }
        } catch (error) {
          console.error('[OrderSummary] Error calculating travel distance on-the-fly:', error);
          console.error('[OrderSummary] Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          });
          // Strategy 3: Estimate from current pricing rules
          travelMiles = await estimateDistanceFromFee(order.travel_fee_cents);
        }
      } else {
        // Strategy 3: Estimate from current pricing rules
        console.log('[OrderSummary] No coordinates available, estimating from fee');
        travelMiles = await estimateDistanceFromFee(order.travel_fee_cents);
      }
    } else {
      console.log('[OrderSummary] Skipping real-time distance calculation:', {
        travelMiles,
        travelFeeCents: order.travel_fee_cents,
        hasAddresses: !!order.addresses,
      });
    }

    const discounts = (discountsRes.data || []) as unknown as OrderDiscount[];
    const customFees = (feesRes.data || []) as unknown as OrderCustomFee[];
    const originalFees = await calculateOriginalFees(order, discounts, customFees);

    return {
      items: (itemsRes.data || []).map(item => ({
        ...item,
        units: item.units || undefined,
      })) as unknown as OrderItem[],
      discounts,
      customFees,
      subtotal_cents: order.subtotal_cents,
      travel_fee_cents: originalFees.travel_fee_cents,
      travel_total_miles: travelMiles,
      surface_fee_cents: originalFees.surface_fee_cents,
      same_day_pickup_fee_cents: originalFees.same_day_pickup_fee_cents,
      generator_fee_cents: originalFees.generator_fee_cents,
      generator_qty: order.generator_qty || 0,
      tax_cents: originalFees.tax_cents,
      tip_cents: order.tip_cents || 0,
      total_cents: calculateTotalFromOrder(order, discounts, customFees),
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
    isNew: item.is_new || false,
  }));

  return buildOrderSummaryDisplay({
    items,
    fees: {
      travel_fee_cents: data.travel_fee_cents,
      travel_total_miles: data.travel_total_miles,
      surface_fee_cents: data.surface_fee_cents,
      same_day_pickup_fee_cents: data.same_day_pickup_fee_cents,
      generator_fee_cents: data.generator_fee_cents,
      generator_qty: data.generator_qty,
      travel_fee_waived: data.travel_fee_waived,
      surface_fee_waived: data.surface_fee_waived,
      same_day_pickup_fee_waived: data.same_day_pickup_fee_waived,
      generator_fee_waived: data.generator_fee_waived,
    },
    discounts: data.discounts,
    customFees: data.customFees,
    subtotal_cents: data.subtotal_cents,
    tax_cents: data.tax_cents,
    tip_cents: data.tip_cents || 0,
    total_cents: data.total_cents,
    deposit_due_cents: data.deposit_due_cents,
    deposit_paid_cents: data.deposit_paid_cents,
    balance_due_cents: data.balance_due_cents,
    event_date: data.event_date,
    event_end_date: data.event_end_date,
    pickup_preference: data.pickup_preference,
  });
}
