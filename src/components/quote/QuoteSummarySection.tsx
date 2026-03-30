interface CartItem {
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
  isAvailable?: boolean;
}

interface PriceBreakdown {
  travel_fee_cents: number;
  travel_fee_display_name?: string;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  generator_fee_cents: number;
  tax_cents: number;
}

interface QuoteSummarySectionProps {
  cart: CartItem[];
  priceBreakdown: PriceBreakdown | null;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function QuoteSummarySection({ cart, priceBreakdown }: QuoteSummarySectionProps) {
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

  const itemSubtotalCents = cart.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

  const feesTotalCents = priceBreakdown
    ? priceBreakdown.travel_fee_cents +
      priceBreakdown.surface_fee_cents +
      priceBreakdown.same_day_pickup_fee_cents +
      priceBreakdown.generator_fee_cents +
      priceBreakdown.tax_cents
    : 0;

  const estimatedTotalCents = itemSubtotalCents + feesTotalCents;

  const hasUnavailableItems = cart.some((item) => item.isAvailable === false);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Quote Summary</h2>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Items:</p>

          {cart.map((item, index) => (
            <div key={index} className="flex items-start justify-between gap-2 py-1 text-xs sm:text-sm">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <span className="text-blue-600 flex-shrink-0 mt-0.5">•</span>
                <span className="text-slate-700 break-words">
                  {item.unit_name}{' '}
                  <span className="text-slate-400">({item.wet_or_dry})</span>
                </span>
              </div>
              <span className="font-semibold text-slate-900 flex-shrink-0">
                {formatDollars(item.unit_price_cents * item.qty)}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100">
            <span className="text-xs sm:text-sm font-semibold text-slate-700">Items subtotal</span>
            <span className="text-sm sm:text-base font-bold text-slate-900">{formatDollars(itemSubtotalCents)}</span>
          </div>
        </div>

        {priceBreakdown ? (
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Fees &amp; Extras:</p>

            {priceBreakdown.travel_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">{priceBreakdown.travel_fee_display_name || 'Travel Fee'}</span>
                <span className="font-semibold text-slate-800">{formatDollars(priceBreakdown.travel_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.surface_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Sandbag Fee</span>
                <span className="font-semibold text-slate-800">{formatDollars(priceBreakdown.surface_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.same_day_pickup_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Same-Day Pickup</span>
                <span className="font-semibold text-slate-800">{formatDollars(priceBreakdown.same_day_pickup_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.generator_fee_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">
                  Generator Rental ({Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2)} unit
                  {Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2) > 1 ? 's' : ''})
                </span>
                <span className="font-semibold text-slate-800">{formatDollars(priceBreakdown.generator_fee_cents)}</span>
              </div>
            )}

            {priceBreakdown.tax_cents > 0 && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-600">Tax (6%)</span>
                <span className="font-semibold text-slate-800">{formatDollars(priceBreakdown.tax_cents)}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-slate-200">
              <span className="text-sm sm:text-base font-bold text-slate-900">Estimated Total</span>
              <span className="text-lg sm:text-xl font-bold text-blue-700">{formatDollars(estimatedTotalCents)}</span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Estimate based on your address and event details. Final total confirmed at checkout.
            </p>
          </div>
        ) : (
          <div className="pt-3 border-t border-slate-200">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs sm:text-sm text-slate-600 text-center leading-relaxed">
                Enter your address and event date to see delivery fees and full pricing estimate.
              </p>
            </div>
          </div>
        )}

        {hasUnavailableItems && (
          <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
            <p className="text-xs sm:text-sm text-red-800 font-medium text-center leading-relaxed">
              Some inflatables are not available for the selected dates. Please choose different dates or remove
              unavailable items.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 sm:py-3.5 px-6 rounded-lg sm:rounded-xl transition-all shadow-md hover:shadow-lg text-sm sm:text-base"
        >
          Continue to Checkout →
        </button>
      </div>
    </div>
  );
}
