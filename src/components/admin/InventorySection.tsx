import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { notifyError, notifySuccess, showConfirm } from '../../lib/notifications';

interface Unit {
  id: string;
  name: string;
  type: string;
  dimensions: string;
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

export function InventorySection({ units, onRefetch }: InventorySectionProps) {
  const navigate = useNavigate();

  async function handleDeleteUnit(unitId: string, unitName: string) {
    if (!await showConfirm(`Are you sure you want to delete "${unitName}"?`)) return;

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
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {units.map((unit) => (
              <tr key={unit.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{unit.name}</div>
                      <div className="text-sm text-slate-500">{unit.dimensions}</div>
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
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => navigate(`/admin/inventory/edit/${unit.id}`)}
                    className="text-blue-600 hover:text-blue-700 mr-3"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteUnit(unit.id, unit.name)}
                    className="text-red-600 hover:text-red-700"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
