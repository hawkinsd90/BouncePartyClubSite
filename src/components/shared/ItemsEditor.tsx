import { Plus, Minus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface Item {
  id?: string;
  unit_id?: string;
  unit_name?: string;
  qty: number;
  wet_or_dry?: 'dry' | 'water';
  mode?: 'dry' | 'water';
  unit_price_cents?: number;
  price_cents?: number;
  adjusted_price_cents?: number;
  inventory_qty?: number;
  is_new?: boolean;
  is_deleted?: boolean;
  is_updated?: boolean;
  product_id?: string;
  bundle_id?: string;
  product_name?: string;
  item_name?: string;
  pricing_context?: string;
  component_snapshot?: any;
  client_id?: string;
}

interface ItemsEditorProps {
  items: Item[];
  units: any[];
  onRemoveItem: (itemOrIndex: any) => void;
  onAddItem: (unit: any, mode: 'dry' | 'water') => void;
  onUpdateQuantity?: (item: any, qty: number) => void;
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

  const isEEItem = (item: Item) => !item.unit_id && (item.product_id || item.bundle_id);
  const isPackage = (item: Item) => !item.unit_id && !!item.bundle_id;

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
    return item.adjusted_price_cents || item.unit_price_cents || item.price_cents || 0;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">{title}</h3>

      {activeItems.length > 0 && (
        <div className="space-y-3 mb-6">
          {activeItems.map((item, index) => {
            const ee = isEEItem(item);
            const pkg = isPackage(item);
            const displayName = ee ? (item.item_name || item.product_name || 'Event Essential') : item.unit_name || 'Unknown';
            return (
            <div
              key={item.id || `${item.unit_id || item.product_id || item.bundle_id}-${item.wet_or_dry || item.mode || 'ee'}-${index}`}
              className={`rounded-lg p-3 ${
                item.is_new ? 'bg-green-50 border border-green-200' : 'bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    {displayName}
                    {item.is_new && (
                      <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                        NEW
                      </span>
                    )}
                  </p>
                  {!ee && (
                    <p className="text-xs sm:text-sm text-slate-600">
                      {getModeLabel(item)}
                    </p>
                  )}
                  {ee && item.pricing_context && (
                    <p className="text-xs text-slate-500">
                      {item.pricing_context === 'addon' ? 'Add-on price' : 'Standalone price'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onRemoveItem(removeByIndex ? index : item)}
                  className="text-red-600 hover:text-red-700 ml-2 p-1"
                  title="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {pkg && item.component_snapshot && Array.isArray(item.component_snapshot.components) && (
                <div className="mb-2 text-xs text-slate-600">
                  <p className="font-medium mb-1">Includes:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {item.component_snapshot.components.map((comp: any, ci: number) => (
                      <li key={ci}>
                        {comp.product_name} x{(comp.quantity_per_bundle || 1) * item.qty}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {pkg && (!item.component_snapshot || !Array.isArray((item.component_snapshot as any)?.components)) && (
                <p className="mb-2 text-xs text-slate-500 italic">Package contents unavailable</p>
              )}

              {(!allowQuantityEdit || !isEEItem(item)) && !allowPriceEdit && (
                <div className="flex items-center text-xs text-slate-600 mb-2">
                  <span>Qty: {item.qty}</span>
                </div>
              )}

              {((allowQuantityEdit && isEEItem(item)) || allowPriceEdit) && (
                <div className="flex items-center justify-between gap-3 mt-2">
                  {allowQuantityEdit && isEEItem(item) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 font-medium">Qty:</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onUpdateQuantity?.(removeByIndex ? index : item, Math.max(1, item.qty - 1))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                          title="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={item.qty}
                          key={`${item.id || item.client_id || index}-${item.qty}`}
                          onBlur={(e) => {
                            const n = Number(e.target.value.trim());
                            if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
                              onUpdateQuantity?.(removeByIndex ? index : item, n);
                            } else {
                              e.target.value = String(item.qty);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const n = Number((e.target as HTMLInputElement).value.trim());
                              if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
                                onUpdateQuantity?.(removeByIndex ? index : item, n);
                              } else {
                                (e.target as HTMLInputElement).value = String(item.qty);
                              }
                            }
                          }}
                          className="w-12 px-1 py-1 text-center text-sm font-semibold text-slate-900 border border-slate-300 rounded focus:outline-none focus:border-blue-500"
                          aria-label={`Quantity for ${displayName}`}
                        />
                        <button
                          onClick={() => onUpdateQuantity?.(removeByIndex ? index : item, item.qty + 1)}
                          className="w-6 h-6 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                          title="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  {allowPriceEdit && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 font-medium">Price:</label>
                      <input
                        type="number"
                        value={(getItemPrice(item) / 100).toFixed(2)}
                        onChange={(e) =>
                          onUpdatePrice?.(index, Math.round(parseFloat(e.target.value) * 100))
                        }
                        step="0.01"
                        className="w-20 px-2 py-1 border border-slate-300 rounded text-sm"
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
            );
          })}
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
                  {!(unit.types || []).includes('Water Slide') || (unit.types || []).includes('Combo') ? (
                    <button
                      onClick={() => onAddItem(unit, 'dry')}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded transition-colors"
                    >
                      Dry {formatCurrency(unit.price_dry_cents || 0)}
                    </button>
                  ) : null}
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
