import { ShoppingCart } from 'lucide-react';
import { formatPriceCents } from '../../lib/eventEssentials/eventEssentialsCatalogResolver';
import { cartBarItemLabel, shouldShowCartBar } from '../../lib/eventEssentials/catalogCartBar';

interface Props {
  totalQty: number;
  subtotalCents: number;
  onViewQuote: () => void;
}

// Phones only: the cart summary sits below every product, so a bar pinned to the bottom keeps the count, the subtotal and "View Quote" in reach.
export function CatalogMobileCartBar({ totalQty, subtotalCents, onViewQuote }: Props) {
  if (!shouldShowCartBar(totalQty)) return null;
  return (
    <div
      data-testid="catalog-mobile-cart-bar"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 leading-tight">{cartBarItemLabel(totalQty)} in your cart</p>
        <p className="text-lg font-bold text-blue-700 leading-tight">{formatPriceCents(subtotalCents)}</p>
      </div>
      <button
        type="button"
        onClick={onViewQuote}
        className="flex-shrink-0 min-h-[48px] inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 rounded-xl shadow-md text-sm"
      >
        <ShoppingCart className="w-4 h-4" />
        View Quote →
      </button>
    </div>
  );
}
