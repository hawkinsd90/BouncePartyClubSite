import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';

interface StagedItem {
  id?: string;
  unit_id: string;
  unit_name: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

interface OrderItemsEditorProps {
  stagedItems: StagedItem[];
  availableUnits: any[];
  onRemoveItem: (item: StagedItem) => void;
  onAddItem: (unit: any, wetOrDry: 'dry' | 'water') => void;
}

export function OrderItemsEditor({ stagedItems, availableUnits, onRemoveItem, onAddItem }: OrderItemsEditorProps) {
  const activeItems = stagedItems.filter(item => !item.is_deleted);

  const unitsAvailableToAdd = availableUnits.filter(unit => {
    const existingItem = activeItems.find(item => item.unit_id === unit.id);
    if (!existingItem) return true;
    return (unit.quantity_available || 1) > 1;
  });

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-slate-900 mb-4">Order Items</h3>
      <div className="space-y-2">
        {activeItems.map((item, index) => (
          <div
            key={item.id || `${item.unit_id}-${item.wet_or_dry}-${index}`}
            className={`flex justify-between items-center rounded-lg p-3 ${item.is_new ? 'bg-green-50 border border-green-200' : 'bg-slate-50'}`}
          >
            <div>
              <p className="font-medium text-slate-900">
                {item.unit_name}
                {item.is_new && <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded">NEW</span>}
              </p>
              <p className="text-sm text-slate-600">{item.wet_or_dry === 'water' ? 'Water' : 'Dry'} • Qty: {item.qty}</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="font-semibold">{formatCurrency(item.unit_price_cents * item.qty)}</p>
              <button
                onClick={() => onRemoveItem(item)}
                className="text-red-600 hover:text-red-800 p-1"
                title="Remove item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
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
                    <span className="ml-2 text-xs text-slate-600">({unit.quantity_available} available)</span>
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAddItem(unit, 'dry')}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded"
                  >
                    Add Dry ({formatCurrency(unit.price_dry_cents)})
                  </button>
                  {unit.price_water_cents && (
                    <button
                      onClick={() => onAddItem(unit, 'water')}
                      className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-2 px-3 rounded"
                    >
                      Add Water ({formatCurrency(unit.price_water_cents)})
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-2 text-center py-6 text-slate-500">
              All available units have been added to this order
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
