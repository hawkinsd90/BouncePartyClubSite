import { Trash2, Plus, Minus } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface CartItemsListProps {
  cartItems: any[];
  units: any[];
  onRemoveItem: (index: number) => void;
  onUpdateQuantity: (index: number, qty: number) => void;
  onUpdatePrice: (index: number, priceCents: number) => void;
  onAddUnit: (unit: any, mode: 'dry' | 'water') => void;
}

export function CartItemsList({
  cartItems,
  units,
  onRemoveItem,
  onUpdateQuantity,
  onUpdatePrice,
  onAddUnit,
}: CartItemsListProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Items</h3>

      {cartItems.length > 0 && (
        <div className="space-y-3 mb-6">
          {cartItems.map((item, index) => (
            <div key={index} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{item.unit_name}</p>
                  <p className="text-xs text-slate-600">{item.wet_or_dry === 'water' ? 'Water' : 'Dry'}</p>
                </div>
                <button
                  onClick={() => onRemoveItem(index)}
                  className="text-red-600 hover:text-red-700 ml-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Quantity</label>
                  {item.inventory_qty > 1 ? (
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <button
                        onClick={() => onUpdateQuantity(index, Math.max(1, item.qty - 1))}
                        className="p-1 bg-slate-200 hover:bg-slate-300 rounded"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
                        min="1"
                        max={item.inventory_qty}
                        className="w-14 sm:w-16 px-2 py-1 border border-slate-300 rounded text-center text-sm"
                      />
                      <button
                        onClick={() => onUpdateQuantity(index, item.qty + 1)}
                        disabled={item.qty >= item.inventory_qty}
                        className="p-1 bg-slate-200 hover:bg-slate-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="px-3 py-2 bg-slate-100 border border-slate-300 rounded text-center text-sm text-slate-700">
                      {item.qty}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Price Each</label>
                  <input
                    type="number"
                    value={(item.adjusted_price_cents / 100).toFixed(2)}
                    onChange={(e) => onUpdatePrice(index, Math.round(parseFloat(e.target.value) * 100))}
                    step="0.01"
                    className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                  />
                </div>
              </div>
              <div className="mt-2 text-right">
                <p className="text-sm font-semibold text-slate-900">
                  Total: {formatCurrency(item.adjusted_price_cents * item.qty)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Add Units</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
          {units
            .filter(unit => {
              // Only show units that have inventory available
              const alreadyInCart = cartItems.filter(item => item.unit_id === unit.id).reduce((sum, item) => sum + item.qty, 0);
              return (unit.inventory_qty || 1) > alreadyInCart;
            })
            .map(unit => (
              <div key={unit.id} className="border border-slate-200 rounded-lg p-3 hover:border-blue-300 transition-colors">
                <p className="font-medium text-slate-900 text-sm mb-2">{unit.name}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAddUnit(unit, 'dry')}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-2 rounded"
                  >
                    Dry {formatCurrency(unit.price_dry_cents)}
                  </button>
                  {unit.price_water_cents && (
                    <button
                      onClick={() => onAddUnit(unit, 'water')}
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-2 px-2 rounded"
                    >
                      Water {formatCurrency(unit.price_water_cents)}
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
