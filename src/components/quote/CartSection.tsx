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
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Cart</h2>
        <div className="text-center py-8">
          <p className="text-slate-600 mb-4">Your cart is empty</p>
          <button
            type="button"
            onClick={() => navigate('/catalog')}
            className="text-blue-600 hover:text-blue-700 font-semibold"
          >
            Browse Inflatables
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Cart</h2>
      <div className="space-y-4">
        {cart.map((item, index) => (
          <div
            key={index}
            className={`p-4 border rounded-lg space-y-3 ${
              item.isAvailable === false
                ? 'border-red-300 bg-red-50'
                : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{item.unit_name}</h3>
                  {item.isAvailable === false && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium bg-red-100 text-red-800">
                      <XCircle className="w-4 h-4" />
                      Not Available
                    </span>
                  )}
                </div>
                <span className="text-sm text-slate-600">Qty: {item.qty}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveItem(index)}
                className="text-red-600 hover:text-red-700 ml-4 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Remove from cart"
              >
                <Trash2 className="w-6 h-6" />
              </button>
            </div>

            {item.isAvailable === false && eventDate && (
              <div className="text-sm text-red-700 bg-red-100 px-3 py-2 rounded">
                This inflatable is already booked for the selected dates. Please choose different dates or remove this item.
              </div>
            )}

            {item.is_combo && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Select Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(index, { wet_or_dry: 'dry' })}
                    className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all text-sm ${
                      item.wet_or_dry === 'dry'
                        ? 'border-blue-600 bg-blue-50 text-blue-900'
                        : 'border-slate-300 text-slate-700 hover:border-blue-400'
                    }`}
                  >
                    <Sun className={`w-4 h-4 mr-1.5 ${
                      item.wet_or_dry === 'dry' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    Dry Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateItem(index, { wet_or_dry: 'water' })}
                    className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all text-sm ${
                      item.wet_or_dry === 'water'
                        ? 'border-blue-600 bg-blue-50 text-blue-900'
                        : 'border-slate-300 text-slate-700 hover:border-blue-400'
                    }`}
                  >
                    <Droplets className={`w-4 h-4 mr-1.5 ${
                      item.wet_or_dry === 'water' ? 'text-blue-600' : 'text-slate-400'
                    }`} />
                    Water Mode
                  </button>
                </div>
              </div>
            )}

            {!item.is_combo && (
              <div className="flex items-center text-sm text-slate-600">
                {item.wet_or_dry === 'water' ? (
                  <>
                    <Droplets className="w-4 h-4 mr-1.5 text-blue-500" />
                    Water Mode
                  </>
                ) : (
                  <>
                    <Sun className="w-4 h-4 mr-1.5 text-amber-500" />
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
          className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-colors font-medium"
        >
          + Add More Inflatables
        </button>
      </div>
    </div>
  );
}
