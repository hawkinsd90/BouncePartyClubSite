import { formatPriceCents } from '../../lib/eventEssentials/eventEssentialsCatalogResolver';
import { isEventEssentialBundleCartItem } from '../../lib/eventEssentials/unifiedCart';
import type { EventEssentialProductCartItem, EventEssentialBundleCartItem } from '../../types';

interface Props {
  items: (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];
  subtotalCents: number;
  minOrderCents: number | null;
  onViewQuote: () => void;
}

// Display only. EventEssentialsCatalog owns the cart and the subtotal.
export function CatalogCartSidebar({ items, subtotalCents, minOrderCents, onViewQuote }: Props) {
  return (
    <div className="lg:col-span-1">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Your Party Add-Ons</h2>

        {items.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            No Party Add-Ons in your cart yet.
          </p>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {items.map((item, index) => {
                const lineTotal = item.unit_price_cents * item.qty;

                return (
                  <div key={index} className="flex items-start justify-between gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-700 font-medium break-words">
                          {isEventEssentialBundleCartItem(item)
                            ? item.bundle_name
                            : item.product_name}
                        </span>
                        {item.pricing_context === 'addon' && (
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Add-on
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">
                        {item.qty} × {formatPriceCents(item.unit_price_cents)}
                      </span>
                    </div>
                    <span className="font-semibold text-slate-900 flex-shrink-0">
                      {formatPriceCents(lineTotal)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 mb-4">
              <span className="font-semibold text-slate-700 text-sm">Subtotal</span>
              <span className="text-lg font-bold text-blue-700">
                {formatPriceCents(subtotalCents)}
              </span>
            </div>

            {minOrderCents != null && minOrderCents > 0 && subtotalCents < minOrderCents && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <p className="text-xs text-amber-800">
                  Minimum order: {formatPriceCents(minOrderCents)}. Add{' '}
                  {formatPriceCents(minOrderCents - subtotalCents)} more.
                </p>
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onViewQuote}
          className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg text-sm transition-colors"
        >
          View Full Quote →
        </button>
      </div>
    </div>
  );
}
