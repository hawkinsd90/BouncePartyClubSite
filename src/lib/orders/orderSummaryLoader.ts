import { supabase } from '../supabase';
import { calculateDrivingDistance } from '../pricing';
import { HOME_BASE } from '../businessLocation';
import { buildOrderSummaryDisplay } from './orderSummaryDisplay';
import { storedOrderTotalCents } from '../pricing/orderMoney';
import { storedFeeAmounts } from '../pricing/orderFeeDisplay';
import { formatStoredOrderItems } from './formatStoredOrderItems';
import type { Database } from '../database.types';

type PricingRuleRow = Database['public']['Tables']['pricing_rules']['Row'];

export { formatStoredOrderItems } from './formatStoredOrderItems';

async function estimateDistanceFromFee(travelFeeCents: number, pricing?: PricingRuleRow | null): Promise<number> {
  try {
    // console.log('[estimateDistanceFromFee] Estimating distance from fee:', travelFeeCents / 100);

    const pricingData = pricing ?? (await supabase
      .from('pricing_rules')
      .select('base_radius_miles, per_mile_after_base_cents')
      .maybeSingle()).data;

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

    // console.log('[estimateDistanceFromFee] Estimated distance:', {
    //   baseRadius,
    //   perMileCents,
    //   chargeableMiles: chargeableMiles.toFixed(2),
    //   estimatedDistance: estimatedDistance.toFixed(2),
    // });

    return estimatedDistance;
  } catch (error) {
    console.error('[estimateDistanceFromFee] Error estimating distance:', error);
    return 0;
  }
}

export interface OrderItem {
  id?: string;
  unit_id: string | null;
  product_id?: string | null;
  bundle_id?: string | null;
  item_name?: string | null;
  pricing_context?: 'standalone' | 'addon' | null;
  component_snapshot?: import('../../types').BundleComponentSnapshot | null;
  qty: number;
  wet_or_dry: 'dry' | 'water' | null;
  unit_price_cents: number;
  is_new?: boolean;
  units?: {
    name: string;
  } | null;
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
  eeProductItems?: Array<{
    product_id: string;
    bundle_id?: string;
    item_name?: string;
    product_name: string;
    qty: number;
    unit_price_cents: number;
    pricing_context?: string;
    component_snapshot?: { components?: Array<{ product_name: string; quantity_per_bundle: number }> } | null;
    is_new?: boolean;
  }>;
  discounts: OrderDiscount[];
  customFees: OrderCustomFee[];
  subtotal_cents: number;
  travel_fee_cents: number;
  travel_total_miles: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  same_day_weekday_delivery_fee_cents: number;
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
  same_day_weekday_delivery_fee_waived?: boolean;
  generator_fee_waived?: boolean;
  setup_fee_cents?: number;
  // Waived fees whose historical amount was never stored: shown as "Waived" with no dollar figure.
  waived_amount_unknown?: Array<'travel' | 'surface' | 'same_day_pickup' | 'same_day_weekday_delivery' | 'generator'>;
}

export interface OrderSummaryDisplay {
  items: Array<{
    name: string;
    mode: string;
    price: number;
    qty: number;
    lineTotal: number;
    isNew?: boolean;
    components?: Array<{ name: string; quantity: number }>;
    packageContentsUnavailable?: boolean;
  }>;
  fees: Array<{
    name: string;
    amount: number;
    // A waived fee whose historical amount is unknown: shown as "Waived" without a dollar figure.
    amountUnknown?: boolean;
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

// Raw rows for one order, from whichever trusted source produced them (direct admin/owner queries, or the Customer
// Portal's server projection). Everything the summary needs is passed in, so building it needs no table access.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RawOrderSummaryInput {
  order: any;
  items: any[];
  discounts: any[];
  customFees: any[];
  // Pricing configuration; when omitted it is read from pricing_rules as before.
  pricing?: PricingRuleRow | null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadOrderSummary(orderId: string): Promise<OrderSummaryData | null> {
  try {
    const [orderRes, itemsRes, discountsRes, feesRes] = await Promise.all([
      supabase.from('orders').select('*, customers(*), addresses(*)').eq('id', orderId).maybeSingle(),
      supabase.from('order_items').select('*, units(name)').eq('order_id', orderId),
      supabase.from('order_discounts').select('*').eq('order_id', orderId),
      supabase.from('order_custom_fees').select('*').eq('order_id', orderId),
    ]);

    if (!orderRes.data) return null;

    return await buildOrderSummaryData(
      {
        order: orderRes.data,
        items: itemsRes.data || [],
        discounts: discountsRes.data || [],
        customFees: feesRes.data || [],
      },
      { persistTravelMiles: false },
    );
  } catch (error) {
    console.error('Error loading order summary:', error);
    return null;
  }
}

// Builds the summary from already-loaded rows. A driving distance computed here is for DISPLAY only and is never written
// back: the travel snapshot is owned by the server (staff-order-save). `persistTravelMiles` is accepted for callers but ignored.
export async function buildOrderSummaryData(
  input: RawOrderSummaryInput,
  _options: { persistTravelMiles?: boolean } = {},
): Promise<OrderSummaryData | null> {
  void _options;
  try {
    const order = input.order;
    let travelMiles = order.travel_total_miles || 0;

    // If travel miles not saved and we have travel fee, calculate it in real-time
    if (travelMiles === 0 && order.travel_fee_cents > 0) {
      // Strategy 1: Use stored travel_per_mile_cents if available
      if (order.travel_per_mile_cents && order.travel_per_mile_cents > 0) {
        // console.log('[OrderSummary] Estimating distance from stored per-mile rate');
        const pricingData = input.pricing ?? (await supabase
          .from('pricing_rules')
          .select('base_radius_miles')
          .maybeSingle()).data;

        const baseRadius = parseFloat(pricingData?.base_radius_miles?.toString() || '10');
        const chargeableMiles = order.travel_fee_cents / order.travel_per_mile_cents;
        travelMiles = baseRadius + chargeableMiles;

        // console.log('[OrderSummary] Estimated distance:', {
        //   baseRadius,
        //   chargeableMiles: chargeableMiles.toFixed(2),
        //   totalMiles: travelMiles.toFixed(2),
        // });
      }
      // Strategy 2: Try to calculate from coordinates
      else if (order.addresses) {
        // console.log('[OrderSummary] Attempting real-time travel distance calculation', {
        //   orderId,
        //   travelFeeCents: order.travel_fee_cents,
        //   hasAddresses: !!order.addresses,
        //   addressData: order.addresses,
        // });

        try {
          const addr = order.addresses as any;
          const lat = parseFloat(addr.lat);
          const lng = parseFloat(addr.lng);

          // console.log('[OrderSummary] Parsed coordinates:', { lat, lng, isValid: !!(lat && lng) });

          if (lat && lng) {
            // console.log('[OrderSummary] Calling calculateDrivingDistance...');
            travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);
            // console.log('[OrderSummary] Distance calculation result:', travelMiles, 'miles');
            if (travelMiles <= 0) {
              console.warn('[OrderSummary] Calculated distance was 0 or invalid');
            }
          } else {
            console.warn('[OrderSummary] Invalid coordinates - lat or lng is falsy', { lat, lng });
            // Strategy 3: Estimate from current pricing rules
            travelMiles = await estimateDistanceFromFee(order.travel_fee_cents, input.pricing);
          }
        } catch (error) {
          console.error('[OrderSummary] Error calculating travel distance on-the-fly:', error);
          console.error('[OrderSummary] Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          });
          // Strategy 3: Estimate from current pricing rules
          travelMiles = await estimateDistanceFromFee(order.travel_fee_cents, input.pricing);
        }
      } else {
        // Strategy 3: Estimate from current pricing rules
        // console.log('[OrderSummary] No coordinates available, estimating from fee');
        travelMiles = await estimateDistanceFromFee(order.travel_fee_cents, input.pricing);
      }
    } else {
      // console.log('[OrderSummary] Skipping real-time distance calculation:', {
      //   travelMiles,
      //   travelFeeCents: order.travel_fee_cents,
      //   hasAddresses: !!order.addresses,
      // });
    }

    const discounts = (input.discounts || []) as unknown as OrderDiscount[];
    const customFees = (input.customFees || []) as unknown as OrderCustomFee[];
    const originalFees = storedFeeAmounts(order);

    return {
      items: (input.items || []).map(item => ({
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
      same_day_weekday_delivery_fee_cents: originalFees.same_day_weekday_delivery_fee_cents,
      generator_fee_cents: originalFees.generator_fee_cents,
      generator_qty: order.generator_qty || 0,
      tax_cents: originalFees.tax_cents,
      waived_amount_unknown: originalFees.waived_amount_unknown,
      tip_cents: order.tip_cents || 0,
      total_cents: calculateTotalFromOrder(order, discounts, customFees),
      deposit_due_cents: order.deposit_due_cents,
      deposit_paid_cents: order.deposit_paid_cents || 0,
      balance_due_cents: order.balance_due_cents,
      custom_deposit_cents: order.custom_deposit_cents,
      pickup_preference: order.pickup_preference,
      event_date: order.event_date,
      event_end_date: order.event_end_date || undefined,
      same_day_weekday_delivery_fee_waived: order.same_day_weekday_delivery_fee_waived || false,
      setup_fee_cents: order.setup_fee_cents || 0,
    };
  } catch (error) {
    console.error('Error loading order summary:', error);
    return null;
  }
}

export function calculateTotalFromOrder(order: any, discounts: OrderDiscount[], customFees: OrderCustomFee[]): number {
  // subtotal_cents already includes event_essentials_subtotal_cents; the tip is tracked separately and is not part of the total.
  // The arithmetic is orderMoney's, shared with every screen and Edge Function that shows or charges an order total.
  return storedOrderTotalCents(order, discounts, customFees);
}

export function formatOrderSummary(data: OrderSummaryData): OrderSummaryDisplay {
  const items = formatStoredOrderItems(data.items);

  // Append staged EE product items (not yet persisted as order_items)
  const eeItems = (data.eeProductItems || []).map(ee => ({
    name: ee.item_name || ee.product_name,
    mode: ee.bundle_id ? 'Package' : 'Event Essential',
    price: ee.unit_price_cents,
    qty: ee.qty,
    isNew: ee.is_new || false,
    components: ee.bundle_id && ee.component_snapshot?.components
      ? ee.component_snapshot.components.map(component => ({ name: component.product_name, quantity: component.quantity_per_bundle * ee.qty }))
      : undefined,
    packageContentsUnavailable: ee.bundle_id ? !ee.component_snapshot?.components : undefined,
  }));

  return buildOrderSummaryDisplay({
    items: [...items, ...eeItems],
    fees: {
      travel_fee_cents: data.travel_fee_cents,
      travel_total_miles: data.travel_total_miles,
      surface_fee_cents: data.surface_fee_cents,
      same_day_pickup_fee_cents: data.same_day_pickup_fee_cents,
      same_day_weekday_delivery_fee_cents: data.same_day_weekday_delivery_fee_cents,
      generator_fee_cents: data.generator_fee_cents,
      generator_qty: data.generator_qty,
      waived_amount_unknown: data.waived_amount_unknown,
      travel_fee_waived: data.travel_fee_waived,
      surface_fee_waived: data.surface_fee_waived,
      same_day_pickup_fee_waived: data.same_day_pickup_fee_waived,
      same_day_weekday_delivery_fee_waived: data.same_day_weekday_delivery_fee_waived,
      generator_fee_waived: data.generator_fee_waived,
      setup_fee_cents: data.setup_fee_cents || 0,
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
