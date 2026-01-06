import { Plus, Minus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface Item {
  id?: string;
  unit_id: string;
  unit_name: string;
  qty: number;
  wet_or_dry?: 'dry' | 'water';
  mode?: 'dry' | 'water';
  unit_price_cents: number;
  adjusted_price_cents?: number;
  inventory_qty?: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

interface ItemsEditorProps {
  items: Item[];
  units: any[];
  onRemoveItem: (itemOrIndex: any) => void;
  onAddItem: (unit: any, mode: 'dry' | 'water') => void;
  onUpdateQuantity?: (index: number, qty: number) => void;
  onUpdatePrice?: (index: number, priceCents: number) => void;
  allowQuantityEdit?: boolean;
  allowPriceEdit?: boolean;
  title?: string;
  removeByIndex?: boolean;
}

export function ItemsEditor({
  items,
  units,
  onRemoveItem,
  onAddItem,
  onUpdateQuantity,
  onUpdatePrice,
  allowQuantityEdit = false,
  allowPriceEdit = false,
  title = 'Items',
  removeByIndex = false,
}: ItemsEditorProps) {
  const activeItems = items.filter(item => !item.is_deleted);

  const unitsAvailableToAdd = units.filter(unit => {
    const existingItem = activeItems.find(item => item.unit_id === unit.id);
    if (!existingItem) return true;
    return (unit.quantity_available || 1) > 1;
  });

  const getModeLabel = (item: Item) => {
    const mode = item.wet_or_dry || item.mode;
    return mode === 'water' ? 'Water' : 'Dry';
  };

  const getItemPrice = (item: Item) => {
    return item.adjusted_price_cents || item.unit_price_cents;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">{title}</h3>

      {activeItems.length > 0 && (
        <div className="space-y-3 mb-6">
          {activeItems.map((item, index) => (
            <div
              key={item.id || `${item.unit_id}-${item.wet_or_dry || item.mode}-${index}`}
              className={`rounded-lg p-3 ${
                item.is_new ? 'bg-green-50 border border-green-200' : 'bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    {item.unit_name}
                    {item.is_new && (
                      <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                        NEW
                      </span>
                    )}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-600">
                    {getModeLabel(item)}
                    {!allowQuantityEdit && ` • Qty: ${item.qty}`}
                  </p>
                </div>
                <button
                  onClick={() => onRemoveItem(removeByIndex ? index : item)}
                  className="text-red-600 hover:text-red-700 ml-2 p-1"
                  title="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {(allowQuantityEdit || allowPriceEdit) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mt-2">
                  {allowQuantityEdit && (
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Quantity</label>
                      {item.inventory_qty && item.inventory_qty > 1 ? (
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <button
                            onClick={() => onUpdateQuantity?.(index, Math.max(1, item.qty - 1))}
                            className="p-1 bg-slate-200 hover:bg-slate-300 rounded"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            value={item.qty}
                            onChange={(e) => onUpdateQuantity?.(index, parseInt(e.target.value) || 1)}
                            min="1"
                            max={item.inventory_qty}
                            className="w-14 sm:w-16 px-2 py-1 border border-slate-300 rounded text-center text-sm"
                          />
                          <button
                            onClick={() => onUpdateQuantity?.(index, item.qty + 1)}
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
                  )}

                  {allowPriceEdit && (
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Price Each</label>
                      <input
                        type="number"
                        value={(getItemPrice(item) / 100).toFixed(2)}
                        onChange={(e) =>
                          onUpdatePrice?.(index, Math.round(parseFloat(e.target.value) * 100))
                        }
                        step="0.01"
                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2 text-right">
                <p className="text-sm font-semibold text-slate-900">
                  Total: {formatCurrency(getItemPrice(item) * item.qty)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-slate-200 pt-4">
        <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Item
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
          {unitsAvailableToAdd.length > 0 ? (
            unitsAvailableToAdd.map(unit => (
              <div key={unit.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-medium text-slate-900 mb-2">
                  {unit.name}
                  {(unit.quantity_available || 1) > 1 && (
                    <span className="ml-2 text-xs text-slate-600">
                      ({unit.quantity_available} available)
                    </span>
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAddItem(unit, 'dry')}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded transition-colors"
                  >
                    Dry {formatCurrency(unit.price_dry_cents || 0)}
                  </button>
                  {(unit.price_water_cents || 0) > 0 && (
                    <button
                      onClick={() => onAddItem(unit, 'water')}
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-2 px-3 rounded transition-colors"
                    >
                      Water {formatCurrency(unit.price_water_cents || 0)}
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center text-slate-500 py-4">
              No units available to add
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
