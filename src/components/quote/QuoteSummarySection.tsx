import type { UnifiedCartItem, InflatableCartItem, EventEssentialProductCartItem, EventEssentialBundleCartItem } from '../../types';
import { calculateEventEssentialsSubtotalCents } from '../../lib/eventEssentialsMoney';
import { formatCurrency } from '../../lib/pricing';
import { buildPackageDisplay } from '../../lib/packageDisplay';
import type { UnifiedQuoteTotals } from '../../lib/unifiedTotals';

interface PriceBreakdown {
  travel_fee_cents: number;
  travel_fee_display_name?: string;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  same_day_weekday_delivery_fee_cents: number;
  generator_fee_cents: number;
  tax_cents: number;
  tax_applied: boolean;
  subtotal_cents: number;
  deposit_due_cents: number;
  total_cents: number;
}

interface QuoteSummarySectionProps {
  cart: UnifiedCartItem[];
  priceBreakdown: PriceBreakdown | null;
  totals: UnifiedQuoteTotals | null;
  pricingConfigError: string | null;
  isCalculating: boolean;
}

export { getQuotePricingDisplayState } from '../../lib/quotePricingDisplayState';

function isInflatable(item: UnifiedCartItem): item is InflatableCartItem {
  return item.item_type === undefined || item.item_type === 'inflatable';
}

export function QuoteSummarySection({ cart, priceBreakdown, totals, pricingConfigError, isCalculating }: QuoteSummarySectionProps) {
  if (cart.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Quote Summary</h2>
        <div className="text-center py-8">
          <p className="text-slate-600 text-sm sm:text-base">Add items to see your quote</p>
        </div>
      </div>
    );
  }

  const inflatableItems = cart.filter(isInflatable);
  const eventEssentialsItems = cart.filter(
    (item): item is EventEssentialProductCartItem | EventEssentialBundleCartItem =>
      !isInflatable(item)
  );

  const eventEssentialsSubtotalCents = calculateEventEssentialsSubtotalCents(cart);

  const inflatableSubtotalCents = inflatableItems.reduce(
    (sum, item) => sum + item.unit_price_cents * item.qty,
    0
  );

  const hasUnavailableItems = cart.some((item) => item.isAvailable === false);

  const showPricingSection = totals !== null && !pricingConfigError;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Quote Summary</h2>

      <div className="space-y-4">
        {inflatableItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Inflatables:</p>

            {inflatableItems.map((item, index) => (
              <div key={`inf-${index}`} className="flex items-start justify-between gap-2 py-1 text-xs sm:text-sm">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-blue-600 flex-shrink-0 mt-0.5">•</span>
                  <span className="text-slate-700 break-words">
                    {item.unit_name}{' '}
                    <span className="text-slate-400">({item.wet_or_dry})</span>
                  </span>
                </div>
                <span className="font-semibold text-slate-900 flex-shrink-0">
                  {formatCurrency(item.unit_price_cents * item.qty)}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100">
              <span className="text-xs sm:text-sm font-semibold text-slate-700">Inflatables subtotal</span>
              <span className="text-sm sm:text-base font-bold text-slate-900">{formatCurrency(inflatableSubtotalCents)}</span>
            </div>
          </div>
        )}

        {eventEssentialsItems.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Event Essentials:</p>

            {eventEssentialsItems.map((item, index) => {
              if (item.item_type === 'event_essential_bundle') {
                const pkgDisplay = buildPackageDisplay({
                  bundleName: item.bundle_name,
                  bundleQty: item.qty,
                  unitPriceCents: item.unit_price_cents,
                  componentSnapshot: item.component_snapshot,
                });
                return (
                  <div key={`ee-${index}`} className="py-1">
                    {pkgDisplay.hasSnapshot && pkgDisplay.components.length > 0 && (
                      <div className="mb-2 pl-4">
                        <p className="text-xs text-slate-500 mb-1">Included:</p>
                        {pkgDisplay.components.map((c, ci) => (
                          <div key={ci} className="text-xs text-slate-500">
                            - {c.name} × {c.quantity}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2 text-xs sm:text-sm">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="text-emerald-600 flex-shrink-0 mt-0.5">•</span>
                        <span className="text-slate-700 break-words">
                          {pkgDisplay.packageName}
                          {item.isAvailable === false && (
                            <span className="ml-1 text-red-600 font-medium">(unavailable)</span>
                          )}
                        </span>
                      </div>
                      <span className="font-semibold text-slate-900 flex-shrink-0">
                        {formatCurrency(item.unit_price_cents * item.qty)}
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={`ee-${index}`} className="flex items-start justify-between gap-2 py-1 text-xs sm:text-sm">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className="text-emerald-600 flex-shrink-0 mt-0.5">•</span>
                    <span className="text-slate-700 break-words">
                      {item.product_name}
                      {item.isAvailable === false && (
                        <span className="ml-1 text-red-600 font-medium">(unavailable)</span>
                      )}
                    </span>
                  </div>
                  <span className="font-semibold text-slate-900 flex-shrink-0">
                    {formatCurrency(item.unit_price_cents * item.qty)}
                  </span>
                </div>
              );
            })}

            <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100">
              <span className="text-xs sm:text-sm font-semibold text-slate-700">Event Essentials subtotal</span>
              <span className="text-sm sm:text-base font-bold text-slate-900">{formatCurrency(eventEssentialsSubtotalCents)}</span>
            </div>
          </div>
        )}

        {showPricingSection && priceBreakdown && totals && (
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Fees &amp; Extras:</p>

            {priceBreakdown.travel_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">{priceBreakdown.travel_fee_display_name || 'Travel Fee'}</span>
                <span className="font-semibold text-slate-800">{formatCurrency(priceBreakdown.travel_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.surface_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Sandbag Fee</span>
                <span className="font-semibold text-slate-800">{formatCurrency(priceBreakdown.surface_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.same_day_pickup_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Same-Day Pickup</span>
                <span className="font-semibold text-slate-800">{formatCurrency(priceBreakdown.same_day_pickup_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.same_day_weekday_delivery_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Same-Day Delivery</span>
                <span className="font-semibold text-slate-800">{formatCurrency(priceBreakdown.same_day_weekday_delivery_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.generator_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">
                  Generator Rental ({Math.ceil(inflatableItems.reduce((sum, item) => sum + item.qty, 0) / 2)} unit
                  {Math.ceil(inflatableItems.reduce((sum, item) => sum + item.qty, 0) / 2) > 1 ? 's' : ''})
                </span>
                <span className="font-semibold text-slate-800">{formatCurrency(priceBreakdown.generator_fee_cents)}</span>
              </div>
            )}

            {totals.taxCents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Tax (6%)</span>
                <span className="font-semibold text-slate-800">{formatCurrency(totals.taxCents)}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-slate-200">
              <span className="text-sm sm:text-base font-bold text-slate-900">Estimated Total</span>
              <span className="text-lg sm:text-xl font-bold text-blue-700">{formatCurrency(totals.totalCents)}</span>
            </div>

            {totals.depositCents > 0 && (
              <div className="space-y-1 pt-2">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-600">Required Deposit</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(totals.depositCents)}</span>
                </div>
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-slate-600">Remaining Balance</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(totals.balanceDueCents)}</span>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              Estimate based on your address and event details. Final total confirmed at checkout.
            </p>
          </div>
        )}

        {!showPricingSection && !pricingConfigError && (
          <div className="pt-3 border-t border-slate-200">
            <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
              <p className="text-xs sm:text-sm text-blue-800 font-medium text-center leading-relaxed">
                Calculating pricing...
              </p>
            </div>
          </div>
        )}

        {hasUnavailableItems && (
          <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
            <p className="text-xs sm:text-sm text-red-800 font-medium text-center leading-relaxed">
              Some items are not available for the selected dates. Please choose different dates or remove
              unavailable items.
            </p>
          </div>
        )}

        {pricingConfigError && (
          <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
            <p className="text-xs sm:text-sm text-red-800 font-medium text-center leading-relaxed">
              Pricing configuration error: {pricingConfigError}. Please contact us for assistance.
            </p>
          </div>
        )}

        {totals?.depositError && (
          <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
            <p className="text-xs sm:text-sm text-red-800 font-medium text-center leading-relaxed">
              Unable to calculate deposit: {totals.depositError}. Please contact us for assistance.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={!totals || !!pricingConfigError || isCalculating || !!totals?.depositError}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 sm:py-3.5 px-6 rounded-lg sm:rounded-xl transition-all shadow-md hover:shadow-lg text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue to Checkout →
        </button>
      </div>
    </div>
  );
}
