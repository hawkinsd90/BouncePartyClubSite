import { useNavigate } from 'react-router-dom';
import { Trash2, Sun, Droplets, XCircle } from 'lucide-react';

interface CartItem {
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
  is_combo?: boolean;
  isAvailable?: boolean;
}

interface CartSectionProps {
  cart: CartItem[];
  eventDate: string;
  onUpdateItem: (index: number, updates: Partial<CartItem>) => void;
  onRemoveItem: (index: number) => void;
}

export function CartSection({ cart, eventDate, onUpdateItem, onRemoveItem }: CartSectionProps) {
  const navigate = useNavigate();

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
          <button
            type="button"
            onClick={() => navigate('/catalog')}
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm sm:text-base transition-colors"
          >
            Browse Inflatables →
          </button>
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
        {cart.map((item, index) => (
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

            {item.is_combo && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">Select Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(index, { wet_or_dry: 'dry' })}
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
                    onClick={() => onUpdateItem(index, { wet_or_dry: 'water' })}
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
        ))}
        <button
          type="button"
          onClick={() => navigate('/catalog')}
          className="w-full py-3 sm:py-3.5 border-2 border-dashed border-slate-300 rounded-lg sm:rounded-xl text-slate-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all font-medium text-sm sm:text-base"
        >
          + Add More Inflatables
        </button>
      </div>
    </div>
  );
}
