import type { OrderSummaryDisplay } from './orderSummary';

interface FeeInput {
  travel_fee_cents?: number;
  travel_total_miles?: number;
  travel_fee_display_name?: string;
  surface_fee_cents?: number;
  same_day_pickup_fee_cents?: number;
  generator_fee_cents?: number;
  generator_qty?: number;
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

export function buildFeesList(fees: FeeInput): Array<{ name: string; amount: number }> {
  const feesList: Array<{ name: string; amount: number }> = [];

  // Show travel fee if it exists (even if 0 due to waiver)
  if (fees.travel_fee_cents !== undefined && fees.travel_fee_cents !== null) {
    let travelFeeName = fees.travel_fee_display_name || 'Travel Fee';
    if (fees.travel_total_miles && fees.travel_total_miles > 0) {
      travelFeeName = `Travel Fee (${fees.travel_total_miles.toFixed(1)} mi)`;
    }
    feesList.push({ name: travelFeeName, amount: fees.travel_fee_cents });
  }

  // Show surface fee if it exists (even if 0 due to waiver)
  if (fees.surface_fee_cents !== undefined && fees.surface_fee_cents !== null) {
    feesList.push({ name: 'Surface Fee (Sandbags)', amount: fees.surface_fee_cents });
  }

  // Show same day pickup fee if it exists (even if 0 due to waiver)
  if (fees.same_day_pickup_fee_cents !== undefined && fees.same_day_pickup_fee_cents !== null) {
    feesList.push({ name: 'Same-Day Pickup Fee', amount: fees.same_day_pickup_fee_cents });
  }

  // Show generator fee if it exists (even if 0 due to waiver)
  if (fees.generator_fee_cents !== undefined && fees.generator_fee_cents !== null) {
    const generatorLabel =
      fees.generator_qty && fees.generator_qty > 1
        ? `Generators (${fees.generator_qty}x)`
        : 'Generator';
    feesList.push({ name: generatorLabel, amount: fees.generator_fee_cents });
  }

  return feesList;
}

export function calculateDiscountAmounts(
  discounts: DiscountInput[],
  subtotal_cents: number
): Array<{ name: string; amount: number }> {
  return discounts.map((discount) => {
    let amount = discount.amount_cents || 0;
    if (discount.percentage && discount.percentage > 0) {
      amount = Math.round(subtotal_cents * (discount.percentage / 100));
    }
    return {
      name: discount.name,
      amount: amount,
    };
  });
}

export function buildOrderSummaryDisplay(options: BuildSummaryOptions): OrderSummaryDisplay {
  const items = options.items.map((item) => ({
    name: item.name,
    mode: item.mode,
    price: item.price,
    qty: item.qty,
    lineTotal: item.price * item.qty,
    isNew: item.isNew || false,
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

  const taxableAmount = options.subtotal_cents + totalFees + totalCustomFees - totalDiscounts;

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
