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

  async function checkFutureBookings(unitId: string) {
    const today = new Date().toISOString().split('T')[0];

    const { data: bookings, error } = await supabase
      .from('order_items')
      .select(`
        order_id,
        orders!inner(
          id,
          order_number,
          event_date,
          event_end_date,
          status,
          customer_name
        )
      `)
      .eq('unit_id', unitId)
      .not('orders.status', 'in', '("voided","canceled")')
      .or(`event_date.gte.${today},event_end_date.gte.${today}`, { referencedTable: 'orders' });

    if (error) {
      console.error('Error checking bookings:', error);
      return [];
    }

    return bookings || [];
  }

  async function handleDeleteUnit(unitId: string, unitName: string) {
    const futureBookings = await checkFutureBookings(unitId);

    let confirmMessage = `Are you sure you want to delete "${unitName}"?`;

    if (futureBookings.length > 0) {
      const bookingDetails = futureBookings
        .slice(0, 5)
        .map((b: any) => {
          const order = b.orders;
          return `• Order #${order.order_number} - ${order.customer_name} on ${order.event_date}`;
        })
        .join('\n');

      const moreText = futureBookings.length > 5 ? `\n...and ${futureBookings.length - 5} more` : '';

      confirmMessage = `WARNING: "${unitName}" has ${futureBookings.length} future booking(s)!\n\n${bookingDetails}${moreText}\n\nDeleting this unit may cause issues with these orders. Are you sure you want to continue?`;
    }

    if (!await showConfirm(confirmMessage)) return;

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
  );
}
