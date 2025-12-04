import { formatCurrency } from '../lib/pricing';

interface Unit {
  id: string;
  name: string;
  dimensions?: string;
  price_dry_cents: number;
  price_water_cents?: number | null;
  quantity_available?: number;
}

interface CartItem {
  unit_id: string;
  qty: number;
  [key: string]: any;
}

interface AvailableUnitsSelectorProps {
  units: Unit[];
  cartItems: CartItem[];
  onAddItem: (unit: Unit, mode: 'dry' | 'water') => void;
  title?: string;
  buttonSize?: 'sm' | 'md';
}

export function AvailableUnitsSelector({
  units,
  cartItems,
  onAddItem,
  title = 'Available Units',
  buttonSize = 'sm',
}: AvailableUnitsSelectorProps) {
  const availableUnits = units.filter(unit => {
    // Check if this unit is already in the cart
    const existingItem = cartItems.find(item => item.unit_id === unit.id);

    if (!existingItem) {
      // Unit not in cart, so it's available to add
      return true;
    }

    // Unit is in cart - only show if we have multiple units in inventory
    return (unit.quantity_available || 1) > 1;
  });

  const buttonClasses = buttonSize === 'sm'
    ? 'text-xs py-1 px-2'
    : 'text-sm py-2 px-3';

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
        {availableUnits.length > 0 ? (
          availableUnits.map(unit => (
            <div key={unit.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <p className="font-medium text-slate-900 text-sm">
                {unit.name}
                {(unit.quantity_available || 1) > 1 && (
                  <span className="ml-2 text-xs text-slate-600">({unit.quantity_available} available)</span>
                )}
              </p>
              {unit.dimensions && (
                <p className="text-xs text-slate-600 mb-2">{unit.dimensions}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => onAddItem(unit, 'dry')}
                  className={`flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded ${buttonClasses}`}
                >
                  {buttonSize === 'sm' ? 'Dry' : 'Add Dry'} {formatCurrency(unit.price_dry_cents)}
                </button>
                {unit.price_water_cents && (
                  <button
                    onClick={() => onAddItem(unit, 'water')}
                    className={`flex-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded ${buttonClasses}`}
                  >
                    {buttonSize === 'sm' ? 'Water' : 'Add Water'} {formatCurrency(unit.price_water_cents)}
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-2 text-center py-6 text-slate-500">
            All available units have been added
          </div>
        )}
      </div>
    </div>
  );
}
