import type { OrderSummaryDisplay } from './orderSummaryLoader';
import { composeOrderTotal, effectiveDiscountCents } from '../pricing/orderMoney';

interface FeeInput {
  travel_fee_cents?: number;
  travel_total_miles?: number;
  travel_fee_display_name?: string;
  surface_fee_cents?: number;
  same_day_pickup_fee_cents?: number;
  same_day_weekday_delivery_fee_cents?: number;
  generator_fee_cents?: number;
  generator_qty?: number;
  travel_fee_waived?: boolean;
  surface_fee_waived?: boolean;
  same_day_pickup_fee_waived?: boolean;
  same_day_weekday_delivery_fee_waived?: boolean;
  generator_fee_waived?: boolean;
  setup_fee_cents?: number;
  waived_amount_unknown?: string[];
}

interface DiscountInput {
  name: string;
  amount_cents?: number;
  percentage?: number;
}

interface CustomFeeInput {
  name: string;
  amount_cents: number;
}

interface ItemInput {
  name: string;
  mode: string;
  price: number;
  qty: number;
  isNew?: boolean;
  components?: Array<{ name: string; quantity: number }>;
  packageContentsUnavailable?: boolean;
}

interface BuildSummaryOptions {
  items: ItemInput[];
  fees: FeeInput;
  discounts: DiscountInput[];
  customFees: CustomFeeInput[];
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  event_date?: string;
  event_end_date?: string;
  pickup_preference?: string;
}

export function buildFeesList(fees: FeeInput): Array<{ name: string; amount: number; amountUnknown?: boolean }> {
  const feesList: Array<{ name: string; amount: number; amountUnknown?: boolean }> = [];
  const unknown = new Set(fees.waived_amount_unknown ?? []);

  // Show fees if they have a value > 0 OR if they're explicitly waived
  // This ensures waived fees appear in the list so they can display with WAIVED badge
  if ((fees.travel_fee_cents && fees.travel_fee_cents > 0) || fees.travel_fee_waived) {
    let travelFeeName = fees.travel_fee_display_name || 'Travel Fee';
    if (fees.travel_total_miles && fees.travel_total_miles > 0) {
      travelFeeName = `Travel Fee (${fees.travel_total_miles.toFixed(1)} mi)`;
    }
    feesList.push({ name: travelFeeName, amount: fees.travel_fee_cents || 0, ...(unknown.has('travel') ? { amountUnknown: true } : {}) });
  }

  if ((fees.surface_fee_cents && fees.surface_fee_cents > 0) || fees.surface_fee_waived) {
    feesList.push({ name: 'Surface Fee (Sandbags)', amount: fees.surface_fee_cents || 0, ...(unknown.has('surface') ? { amountUnknown: true } : {}) });
  }

  if ((fees.same_day_pickup_fee_cents && fees.same_day_pickup_fee_cents > 0) || fees.same_day_pickup_fee_waived) {
    feesList.push({ name: 'Same-Day Pickup Fee', amount: fees.same_day_pickup_fee_cents || 0, ...(unknown.has('same_day_pickup') ? { amountUnknown: true } : {}) });
  }

  if ((fees.same_day_weekday_delivery_fee_cents && fees.same_day_weekday_delivery_fee_cents > 0) || fees.same_day_weekday_delivery_fee_waived) {
    feesList.push({ name: 'Same-Day Delivery Fee', amount: fees.same_day_weekday_delivery_fee_cents || 0, ...(unknown.has('same_day_weekday_delivery') ? { amountUnknown: true } : {}) });
  }

  if ((fees.generator_fee_cents && fees.generator_fee_cents > 0) || fees.generator_fee_waived) {
    const generatorLabel =
      fees.generator_qty && fees.generator_qty > 1
        ? `Generators (${fees.generator_qty}x)`
        : 'Generator';
    feesList.push({ name: generatorLabel, amount: fees.generator_fee_cents || 0, ...(unknown.has('generator') ? { amountUnknown: true } : {}) });
  }

  if (fees.setup_fee_cents && fees.setup_fee_cents > 0) {
    feesList.push({ name: 'Setup Fee', amount: fees.setup_fee_cents });
  }

  return feesList;
}

export function calculateDiscountAmounts(
  discounts: DiscountInput[],
  subtotal_cents: number
): Array<{ name: string; amount: number }> {
  // One amount per discount (orderMoney): the fixed amount when it is > 0, else the percentage of the equipment subtotal.
  return discounts.map((discount) => ({
    name: discount.name,
    amount: effectiveDiscountCents(discount, subtotal_cents),
  }));
}

export function buildOrderSummaryDisplay(options: BuildSummaryOptions): OrderSummaryDisplay {
  const items = options.items.map((item) => ({
    name: item.name,
    mode: item.mode,
    price: item.price,
    qty: item.qty,
    lineTotal: item.price * item.qty,
    isNew: item.isNew || false,
    components: item.components || [],
    packageContentsUnavailable: item.packageContentsUnavailable || false,
  }));

  const fees = buildFeesList(options.fees);
  const discounts = calculateDiscountAmounts(options.discounts, options.subtotal_cents);
  const customFees = options.customFees.map((fee) => ({
    name: fee.name,
    amount: fee.amount_cents,
  }));

  const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const totalDiscounts = discounts.reduce((sum, d) => sum + d.amount, 0);
  const totalCustomFees = customFees.reduce((sum, f) => sum + f.amount, 0);

  // The taxable amount, by the same rules that priced the order: same-day pickup and weekday-delivery fees are not taxed.
  const taxableAmount = composeOrderTotal(
    {
      subtotal_cents: options.subtotal_cents,
      travel_fee_cents: options.fees.travel_fee_cents,
      surface_fee_cents: options.fees.surface_fee_cents,
      generator_fee_cents: options.fees.generator_fee_cents,
      setup_fee_cents: options.fees.setup_fee_cents,
    },
    options.discounts,
    options.customFees.map((f) => ({ amount_cents: f.amount_cents })),
    0,
  ).taxableAfterDiscountCents;

  const isMultiDay =
    options.event_end_date &&
    options.event_date &&
    options.event_end_date !== options.event_date;

  return {
    items,
    fees,
    discounts,
    customFees,
    subtotal: options.subtotal_cents,
    totalFees,
    totalDiscounts,
    totalCustomFees,
    taxableAmount,
    tax: options.tax_cents,
    tip: options.tip_cents,
    total: options.total_cents,
    depositDue: options.deposit_due_cents,
    depositPaid: options.deposit_paid_cents,
    balanceDue: options.balance_due_cents,
    isMultiDay: !!isMultiDay,
    pickupPreference: options.pickup_preference || 'next_day',
  };
}
