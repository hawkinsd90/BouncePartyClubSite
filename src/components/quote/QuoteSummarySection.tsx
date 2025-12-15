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
      <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Quote Summary</h2>
        <p className="text-slate-600 text-center py-8">Add items to see your quote</p>
      </div>
    );
  }

  if (!priceBreakdown) {
    return (
      <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Quote Summary</h2>
        <div className="text-center py-8">
          <p className="text-slate-600">Complete event details to see pricing</p>
        </div>
      </div>
    );
  }

  const hasUnavailableItems = cart.some((item) => item.isAvailable === false);

  return (
    <div className="bg-white rounded-xl shadow-md p-6 sticky top-24">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Quote Summary</h2>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700 mb-3">Order Items:</p>

          {cart.map((item, index) => (
            <div key={index} className="text-sm text-slate-600 flex items-start">
              <span className="text-blue-600 mr-2">•</span>
              <span>
                {item.unit_name} ({item.wet_or_dry})
              </span>
            </div>
          ))}

          {priceBreakdown.travel_fee_cents > 0 && (
            <div className="text-sm text-slate-600 flex items-start mt-2">
              <span className="text-blue-600 mr-2">•</span>
              <span>{priceBreakdown.travel_fee_display_name || 'Travel Fee'}</span>
            </div>
          )}

          {priceBreakdown.surface_fee_cents > 0 && (
            <div className="text-sm text-slate-600 flex items-start">
              <span className="text-blue-600 mr-2">•</span>
              <span>Sandbag Fee</span>
            </div>
          )}

          {priceBreakdown.same_day_pickup_fee_cents > 0 && (
            <div className="text-sm text-slate-600 flex items-start">
              <span className="text-blue-600 mr-2">•</span>
              <span>Same-Day Pickup Fee</span>
            </div>
          )}

          {priceBreakdown.generator_fee_cents > 0 && (
            <div className="text-sm text-slate-600 flex items-start">
              <span className="text-blue-600 mr-2">•</span>
              <span>
                Generator Rental ({Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2)}{' '}
                unit{Math.ceil(cart.reduce((sum, item) => sum + item.qty, 0) / 2) > 1 ? 's' : ''})
              </span>
            </div>
          )}

          {priceBreakdown.tax_cents > 0 && (
            <div className="text-sm text-slate-600 flex items-start">
              <span className="text-blue-600 mr-2">•</span>
              <span>Tax (6%)</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-200">
          <p className="text-sm text-slate-500 italic text-center">
            Pricing will be shown on the checkout page
          </p>
        </div>

        {hasUnavailableItems && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-medium text-center">
              Some inflatables are not available for the selected dates. Please choose different
              dates or remove unavailable items.
            </p>
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          Continue to Checkout
        </button>
      </div>
    </div>
  );
}
