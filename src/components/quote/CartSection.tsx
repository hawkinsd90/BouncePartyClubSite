import { useNavigate } from 'react-router-dom';
import { Trash2, Sun, Droplets, XCircle, AlertCircle, Package, AlertTriangle } from 'lucide-react';
import type { UnifiedCartItem } from '../../types';
import type { EventEssentialsCartIssue } from '../../lib/eventEssentialsCartRepricing';
import { formatPriceCents } from '../../lib/eventEssentialsCatalogResolver';
import { productLineKey, bundleLineKey } from '../../lib/eventEssentialsCartRepricing';
import { isInflatableCartItem as isInflatable, isEventEssentialProductCartItem, isEventEssentialBundleCartItem } from '../../lib/unifiedCart';

interface CartSectionProps {
  cart: UnifiedCartItem[];
  eventDate: string;
  onUpdateItem: (index: number, updates: Partial<UnifiedCartItem>) => void;
  onRemoveItem: (index: number) => void;
  eventEssentialsIssues?: EventEssentialsCartIssue[];
}

export function CartSection({ cart, eventDate, onUpdateItem, onRemoveItem, eventEssentialsIssues }: CartSectionProps) {
  const navigate = useNavigate();
  // Map issues by cartIndex. Identity (itemType + itemId) is validated at
  // render time so a stale issue can never appear beside a different line
  // after an add/remove shifts indices.
  const issueByIndex = new Map<number, EventEssentialsCartIssue>();
  if (eventEssentialsIssues) {
    for (const issue of eventEssentialsIssues) {
      issueByIndex.set(issue.cartIndex, issue);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Your Cart</h2>
        </div>
        <div className="text-center py-8 sm:py-12">
          <Trash2 className="w-12 h-12 sm:w-16 sm:h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 mb-4 text-sm sm:text-base">Your cart is empty</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => navigate('/catalog')}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm sm:text-base transition-colors"
            >
              Browse Inflatables →
            </button>
            <button
              type="button"
              onClick={() => navigate('/event-essentials')}
              className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm sm:text-base transition-colors"
            >
              Browse Event Essentials →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Your Cart</h2>
            <p className="text-xs sm:text-sm text-slate-500">
              {cart.length} {cart.length === 1 ? "item" : "items"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {cart.map((item, index) => {
          if (!isInflatable(item)) {
            const isAddOn = 'pricing_context' in item && item.pricing_context === 'addon';

            return (
              <div
                key={index}
                className={`p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl space-y-3 transition-all ${
                  item.isAvailable === false
                    ? 'border-red-300 bg-red-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Package className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <h3 className="font-semibold text-slate-900 text-sm sm:text-base break-words">
                        {item.item_type === 'event_essential_bundle' ? item.bundle_name : item.product_name}
                      </h3>
                      {item.isAvailable === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 whitespace-nowrap">
                          <XCircle className="w-3 h-3" />
                          Not Available
                        </span>
                      )}
                    </div>
                    <span className="text-xs sm:text-sm text-slate-600">Qty: {item.qty}</span>
                    {isAddOn && (
                      <span className="ml-2 text-xs text-slate-400">(Add-on)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(index)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg p-2 transition-colors flex-shrink-0"
                    aria-label="Remove from cart"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {item.isAvailable === false && eventDate && (
                  <div className="text-xs sm:text-sm text-red-800 bg-red-100 px-3 py-2 rounded-lg border border-red-200">
                    This item is not available for the selected dates. Please choose different dates or remove this item.
                  </div>
                )}

                {(() => {
                  const issue = issueByIndex.get(index);
                  // Validate the issue belongs to THIS exact line occurrence
                  // by resolverKey (unique per cart index), itemType, and
                  // itemId. Prevents a stale issue from a previous cart render
                  // from appearing beside a different line after add/remove
                  // or duplicate-index shifts.
                  if (!issue || !issue.blocking) return null;
                  if (isEventEssentialProductCartItem(item)) {
                    if (issue.itemType !== 'event_essential_product') return null;
                    if (issue.itemId !== item.product_id) return null;
                    if (issue.resolverKey !== productLineKey(index, item.product_id)) return null;
                  } else if (isEventEssentialBundleCartItem(item)) {
                    if (issue.itemType !== 'event_essential_bundle') return null;
                    if (issue.itemId !== item.bundle_id) return null;
                    if (issue.resolverKey !== bundleLineKey(index, item.bundle_id)) return null;
                  } else {
                    return null;
                  }
                  return (
                    <div className="flex items-start gap-2 text-xs sm:text-sm text-red-800 bg-red-100 px-3 py-2 rounded-lg border border-red-200">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{issue.message}</span>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between text-xs sm:text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
                  <span>Unit Price</span>
                  <span className="font-semibold text-slate-900">
                    {formatPriceCents(item.unit_price_cents)}
                  </span>
                </div>

                {item.item_type === 'event_essential_bundle' && item.component_snapshot?.components?.length > 0 && (
                  <div className="bg-slate-50 rounded-lg px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Package includes:</p>
                    <ul className="space-y-1">
                      {item.component_snapshot.components.map((comp) => (
                        <li key={comp.product_id} className="flex items-center justify-between text-xs sm:text-sm text-slate-700">
                          <span>{comp.product_name}</span>
                          <span className="font-semibold text-slate-600">×{comp.quantity_per_bundle * item.qty}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          }

          const pricesReady = item.price_dry_cents != null && item.price_water_cents != null;

          return (
            <div
              key={index}
              className={`p-3 sm:p-4 border-2 rounded-lg sm:rounded-xl space-y-3 transition-all ${
                item.isAvailable === false ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900 text-sm sm:text-base break-words">{item.unit_name}</h3>
                    {item.isAvailable === false && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 whitespace-nowrap">
                        <XCircle className="w-3 h-3" />
                        Not Available
                      </span>
                    )}
                  </div>
                  <span className="text-xs sm:text-sm text-slate-600">Qty: {item.qty}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveItem(index)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg p-2 transition-colors flex-shrink-0"
                  aria-label="Remove from cart"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              {item.isAvailable === false && eventDate && (
                <div className="text-xs sm:text-sm text-red-800 bg-red-100 px-3 py-2 rounded-lg border border-red-200">
                  This inflatable is already booked for the selected dates. Please choose different dates or remove this item.
                </div>
              )}

              {item.is_combo && pricesReady && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Select Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateItem(index, {
                        wet_or_dry: 'dry',
                        unit_price_cents: item.price_dry_cents!,
                      })}
                      className={`flex items-center justify-center p-2.5 sm:p-3 rounded-lg border-2 transition-all text-xs sm:text-sm font-medium ${
                        item.wet_or_dry === 'dry'
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-300 text-slate-700 hover:border-blue-400 hover:bg-slate-50'
                      }`}
                    >
                      <Sun
                        className={`w-4 h-4 mr-1.5 flex-shrink-0 ${
                          item.wet_or_dry === 'dry' ? 'text-blue-600' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">Dry Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateItem(index, {
                        wet_or_dry: 'water',
                        unit_price_cents: item.price_water_cents!,
                      })}
                      className={`flex items-center justify-center p-2.5 sm:p-3 rounded-lg border-2 transition-all text-xs sm:text-sm font-medium ${
                        item.wet_or_dry === 'water'
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-300 text-slate-700 hover:border-blue-400 hover:bg-slate-50'
                      }`}
                    >
                      <Droplets
                        className={`w-4 h-4 mr-1.5 flex-shrink-0 ${
                          item.wet_or_dry === 'water' ? 'text-blue-600' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">Water Mode</span>
                    </button>
                  </div>
                </div>
              )}

              {item.is_combo && !pricesReady && (
                <div className="flex items-start gap-2 text-xs sm:text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Remove and re-add this item to switch between Dry and Water mode.</span>
                </div>
              )}

              {!item.is_combo && (
                <div className="flex items-center text-xs sm:text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
                  {item.wet_or_dry === 'water' ? (
                    <>
                      <Droplets className="w-4 h-4 mr-1.5 text-blue-500 flex-shrink-0" />
                      Water Mode
                    </>
                  ) : (
                    <>
                      <Sun className="w-4 h-4 mr-1.5 text-amber-500 flex-shrink-0" />
                      Dry Mode
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => navigate('/catalog')}
          className="w-full py-3 sm:py-3.5 border-2 border-dashed border-slate-300 rounded-lg sm:rounded-xl text-slate-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all font-medium text-sm sm:text-base"
        >
          + Add More Inflatables
        </button>
        <button
          type="button"
          onClick={() => navigate('/event-essentials')}
          className="w-full py-3 sm:py-3.5 border-2 border-dashed border-slate-300 rounded-lg sm:rounded-xl text-slate-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all font-medium text-sm sm:text-base"
        >
          + Add Event Essentials
        </button>
      </div>
    </div>
  );
}
