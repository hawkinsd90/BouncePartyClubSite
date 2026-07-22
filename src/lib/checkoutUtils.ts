import { OrderSummaryDisplay } from './orderSummary';
import { dollarsToCents } from './utils';
import { buildOrderSummaryDisplay } from './orderSummaryHelpers';
import type { PriceBreakdown } from './pricing';
import type { UnifiedCartItem } from '../types';
import { composeUnifiedQuoteTotals, type UnifiedQuoteTotals } from './unifiedTotals';
import { isInflatableCartItem } from './unifiedCart';
import { buildPackageDisplay } from './packageDisplay';
import type { BookingDepositSettingsResult } from './depositCalculation';

export type CheckoutRenderState =
  | { state: 'loading_order' }
  | { state: 'loading_settings' }
  | { state: 'error'; message: string }
  | { state: 'ready'; totals: UnifiedQuoteTotals };

export function determineCheckoutRenderState(args: {
  loading: boolean;
  quoteData: any | null;
  priceBreakdown: PriceBreakdown | null;
  settingsLoading: boolean;
  settingsError: string | null;
  bookingDepositSettings: BookingDepositSettingsResult | null;
  cart: UnifiedCartItem[];
}): CheckoutRenderState {
  if (args.loading || !args.quoteData || !args.priceBreakdown) {
    return { state: 'loading_order' };
  }
  if (args.settingsLoading) {
    return { state: 'loading_settings' };
  }
  if (args.settingsError || !args.bookingDepositSettings || args.bookingDepositSettings.status !== 'ready') {
    return { state: 'error', message: args.settingsError || 'Unable to load pricing configuration.' };
  }
  const totals = composeUnifiedQuoteTotals({
    inflatableBreakdown: args.priceBreakdown,
    cart: args.cart,
    taxApplied: args.priceBreakdown.tax_applied ?? true,
    eeOnlyDepositSettings: args.bookingDepositSettings.eventEssentialsDepositSettings,
    inflatableDepositPerUnitCents: args.bookingDepositSettings.inflatableDepositPerUnitCents,
  });
  if (totals.depositError) {
    return { state: 'error', message: totals.depositError };
  }
  return { state: 'ready', totals };
}

interface QuoteData {
  pickup_preference?: 'same_day' | 'next_day';
  [key: string]: unknown;
}

export function getPaymentAmountCentsFromTotals(
  paymentAmount: 'deposit' | 'full' | 'custom',
  customAmount: string,
  totals: UnifiedQuoteTotals,
): number {
  if (paymentAmount === 'full') {
    return totals.totalCents;
  } else if (paymentAmount === 'custom') {
    const customCents = dollarsToCents(customAmount || '0');
    return Math.max(totals.depositCents, Math.min(customCents, totals.totalCents));
  }
  return totals.depositCents;
}

export function getPaymentAmountCents(
  paymentAmount: 'deposit' | 'full' | 'custom',
  customAmount: string,
  priceBreakdown: PriceBreakdown,
): number {
  if (paymentAmount === 'full') {
    return priceBreakdown.total_cents;
  } else if (paymentAmount === 'custom') {
    const customCents = dollarsToCents(customAmount || '0');
    return Math.max(priceBreakdown.deposit_due_cents, Math.min(customCents, priceBreakdown.total_cents));
  }
  return priceBreakdown.deposit_due_cents;
}

export function getTipAmountCents(
  tipAmount: 'none' | '10' | '15' | '20' | 'custom',
  customTip: string,
  totalCents: number,
): number {
  if (tipAmount === 'none') return 0;
  if (tipAmount === 'custom') {
    return dollarsToCents(customTip || '0');
  }
  const percentage = parseInt(tipAmount);
  return Math.round((totalCents * percentage) / 100);
}

export function buildOrderSummary(
  priceBreakdown: PriceBreakdown,
  cart: UnifiedCartItem[],
  quoteData: QuoteData,
  tipCents: number,
  unifiedTotals?: UnifiedQuoteTotals | null,
): OrderSummaryDisplay | null {
  if (!priceBreakdown || !cart) return null;

  const totals = unifiedTotals ?? null;
  if (!totals) return null;

  const items = cart.map((item) => {
    if (isInflatableCartItem(item)) {
      return {
        name: item.unit_name,
        mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
        price: item.unit_price_cents,
        qty: item.qty,
      };
    }
    if (item.item_type === 'event_essential_bundle') {
      const pkgDisplay = buildPackageDisplay({
        bundleName: item.bundle_name,
        bundleQty: item.qty,
        unitPriceCents: item.unit_price_cents,
        componentSnapshot: item.component_snapshot,
      });
      const isAddOn = item.pricing_context === 'addon';
      return {
        name: isAddOn ? `${pkgDisplay.packageName} (Add-on)` : pkgDisplay.packageName,
        mode: 'Event Essential',
        price: item.unit_price_cents,
        qty: item.qty,
        components: pkgDisplay.hasSnapshot ? pkgDisplay.components : [],
      };
    }
    const isAddOn = item.pricing_context === 'addon';
    return {
      name: isAddOn ? `${item.product_name} (Add-on)` : item.product_name,
      mode: 'Event Essential',
      price: item.unit_price_cents,
      qty: item.qty,
    };
  });

  return buildOrderSummaryDisplay({
    items,
    fees: {
      travel_fee_cents: priceBreakdown.travel_fee_cents,
      travel_fee_display_name: priceBreakdown.travel_fee_display_name,
      surface_fee_cents: priceBreakdown.surface_fee_cents,
      same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents,
      same_day_weekday_delivery_fee_cents: priceBreakdown.same_day_weekday_delivery_fee_cents,
      generator_fee_cents: priceBreakdown.generator_fee_cents,
    },
    discounts: [],
    customFees: [],
    subtotal_cents: totals.equipmentSubtotalCents,
    tax_cents: totals.taxCents,
    tip_cents: tipCents,
    total_cents: totals.totalCents,
    deposit_due_cents: totals.depositCents,
    deposit_paid_cents: 0,
    balance_due_cents: totals.balanceDueCents,
    pickup_preference: quoteData?.pickup_preference || 'next_day',
  });
}
