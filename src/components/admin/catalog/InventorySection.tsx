import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/pricing';
import { todayLocalKey } from '../../../lib/core/localDate';
import { Plus, Edit2, Trash2, Wind, PartyPopper } from 'lucide-react';
import { notifyError, notifySuccess, showConfirm } from '../../../lib/toasts';
import { EventEssentialsAdmin } from './event-essentials/EventEssentialsAdmin';

import { checkFutureBookings } from '../../../lib/units/futureBooking';
import { confirmUnitAction } from '../../../lib/units/futureBookingGate';

interface Unit {
  id: string;
  name: string;
  type: string;
  dimensions: string | null;
  price_dry_cents: number;
  price_water_cents: number | null;
  capacity: number;
  active: boolean;
  is_combo: boolean;
}

interface InventorySectionProps {
  units: Unit[];
  onRefetch: () => void;
}

type InventorySubtab = 'inflatables' | 'event-essentials';

const VALID_SUBTABS: InventorySubtab[] = ['inflatables', 'event-essentials'];

function isValidSubtab(v: string | null): v is InventorySubtab {
  return v !== null && VALID_SUBTABS.includes(v as InventorySubtab);
}

export function InventorySection({ units, onRefetch }: InventorySectionProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeSubtab: InventorySubtab = isValidSubtab(searchParams.get('inventoryTab'))
    ? searchParams.get('inventoryTab') as InventorySubtab
    : 'inflatables';

  function handleSubtabChange(tab: InventorySubtab) {
    const next = new URLSearchParams(searchParams);
    next.set('inventoryTab', tab);
    setSearchParams(next);
  }

  async function handleDeleteUnit(unitId: string, unitName: string) {
    // The unit is deleted only after the future-bookings check SUCCEEDED and the Admin confirmed. A failed check blocks the delete
    // (the Admin can only try the check again or cancel).
    const mayDelete = await confirmUnitAction({
      unitName,
      action: 'delete',
      check: () => checkFutureBookings(supabase, unitId, todayLocalKey()),
      ask: showConfirm,
    });
    if (!mayDelete) return;

    try {
      const { error } = await supabase.from('units').delete().eq('id', unitId);
      if (error) throw error;

      notifySuccess('Unit deleted successfully');
      onRefetch();
    } catch (error) {
      console.error('Error deleting unit:', error);
      notifyError('Failed to delete unit');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => handleSubtabChange('inflatables')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeSubtab === 'inflatables'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Wind className="w-4 h-4" />
          Inflatables
        </button>
        <button
          onClick={() => handleSubtabChange('event-essentials')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeSubtab === 'event-essentials'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <PartyPopper className="w-4 h-4" />
          Event Essentials
        </button>
      </div>

      {activeSubtab === 'inflatables' && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-900">Inventory Management</h2>
            <button
              onClick={() => navigate('/admin/inventory/new')}
              className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Unit
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Price (Dry)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Price (Water)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Capacity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {units.map((unit) => (
                  <tr key={unit.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{unit.name}</div>
                          <div className="text-sm text-slate-500">{unit.dimensions}</div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => navigate(`/admin/inventory/edit/${unit.id}`)}
                            className="inline-flex items-center px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm"
                            title="Edit"
                          >
                            <Edit2 className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                            <span className="hidden sm:inline">Edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteUnit(unit.id, unit.name)}
                            className="inline-flex items-center px-2 sm:px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs sm:text-sm"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-900">{unit.type}</span>
                      {unit.is_combo && (
                        <span className="ml-2 inline-flex text-xs font-semibold px-2 py-1 rounded bg-cyan-100 text-cyan-800">
                          COMBO
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                      {formatCurrency(unit.price_dry_cents)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                      {unit.price_water_cents ? formatCurrency(unit.price_water_cents) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                      {unit.capacity} kids
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex text-xs font-semibold px-2 py-1 rounded ${
                          unit.active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {unit.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubtab === 'event-essentials' && <EventEssentialsAdmin />}
    </div>
  );
}
