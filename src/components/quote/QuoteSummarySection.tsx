interface CartItem {
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
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

  if (!priceBreakdown) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Quote Summary</h2>
        <div className="text-center py-8">
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed">Complete event details to see pricing</p>
        </div>
      </div>
    );
  }

  const hasUnavailableItems = cart.some((item) => item.isAvailable === false);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Quote Summary</h2>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs sm:text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Order Items:</p>

          {cart.map((item, index) => (
            <div key={index} className="text-xs sm:text-sm text-slate-600 flex items-start py-1">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span className="break-words">
                {item.unit_name} <span className="text-slate-500">({item.wet_or_dry})</span>
              </span>
            </div>
          ))}

          {priceBreakdown.travel_fee_cents > 0 && (
            <div className="text-xs sm:text-sm text-slate-600 flex items-start py-1 mt-3 pt-3 border-t border-slate-100">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span className="break-words">{priceBreakdown.travel_fee_display_name || 'Travel Fee'}</span>
            </div>
          )}

          {priceBreakdown.surface_fee_cents > 0 && (
            <div className="text-xs sm:text-sm text-slate-600 flex items-start py-1">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span>Sandbag Fee</span>
            </div>
          )}

          {priceBreakdown.same_day_pickup_fee_cents > 0 && (
            <div className="text-xs sm:text-sm text-slate-600 flex items-start py-1">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span>Same-Day Pickup Fee</span>
            </div>
          )}

          {priceBreakdown.generator_fee_cents > 0 && (
            <div className="text-xs sm:text-sm text-slate-600 flex items-start py-1">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span>
                Generator Rental ({Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2)} unit
                {Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2) > 1 ? 's' : ''})
              </span>
            </div>
          )}

          {priceBreakdown.tax_cents > 0 && (
            <div className="text-xs sm:text-sm text-slate-600 flex items-start py-1">
              <span className="text-blue-600 mr-2 flex-shrink-0">•</span>
              <span>Tax (6%)</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-200">
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs sm:text-sm text-blue-900 text-center font-medium">
              💰 Pricing will be shown on the checkout page
            </p>
          </div>
        </div>

        {hasUnavailableItems && (
          <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg">
            <p className="text-xs sm:text-sm text-red-800 font-medium text-center leading-relaxed">
              ⚠️ Some inflatables are not available for the selected dates. Please choose different dates or remove
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
