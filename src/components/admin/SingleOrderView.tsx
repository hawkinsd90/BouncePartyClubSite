import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PendingOrderCard } from './PendingOrderCard';
import { supabase } from '../../lib/supabase';
import { ORDER_STATUS } from '../../lib/constants/statuses';

interface SingleOrderViewProps {
  orderId: string;
  openEditMode?: boolean;
  onBack: () => void;
  onUpdate: () => void;
}

export function SingleOrderView({ orderId, openEditMode = false, onBack, onUpdate }: SingleOrderViewProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    try {
      setLoading(true);
      setError(null);

      const { data, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*),
          order_items (
            *,
            units (*)
          ),
          order_custom_fees (*),
          order_discounts (*)
        `)
        .eq('id', orderId)
        .maybeSingle();

      if (orderError) throw orderError;
      if (!data) {
        setError('Order not found');
        return;
      }

      setOrder(data);
    } catch (err: any) {
      console.error('Error loading order:', err);
      setError(err.message || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  }

  function handleUpdate() {
    loadOrder();
    onUpdate();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-600">Loading order...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <button
          onClick={onBack}
          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </button>
        <div className="text-center py-12">
          <p className="text-red-600 text-lg font-semibold mb-2">Error Loading Order</p>
          <p className="text-slate-600">{error || 'Order not found'}</p>
        </div>
      </div>
    );
  }

  const isPendingOrAwaiting =
    order.status === ORDER_STATUS.PENDING ||
    order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL ||
    order.status === ORDER_STATUS.DRAFT;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Orders
      </button>

      {isPendingOrAwaiting ? (
        <PendingOrderCard order={order} onUpdate={handleUpdate} openEditMode={openEditMode} />
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="text-slate-600">
              {order.customers?.first_name} {order.customers?.last_name}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-slate-600 mb-1">Status</p>
              <p className="font-semibold text-slate-900">{order.status}</p>
            </div>
            <div>
              <p className="text-slate-600 mb-1">Event Date</p>
              <p className="font-semibold text-slate-900">{order.event_date}</p>
            </div>
            <div>
              <p className="text-slate-600 mb-1">Location</p>
              <p className="font-semibold text-slate-900">
                {order.addresses?.line1}<br />
                {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}
              </p>
            </div>
            <div>
              <p className="text-slate-600 mb-1">Total</p>
              <p className="font-semibold text-slate-900">
                ${((order.total_cents || 0) / 100).toFixed(2)}
              </p>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-200">
            <h3 className="font-semibold text-slate-900 mb-3">Items</h3>
            <ul className="space-y-2">
              {order.order_items?.map((item: any) => (
                <li key={item.id} className="flex justify-between text-sm">
                  <span className="text-slate-700">
                    {item.units?.name} ({item.wet_or_dry === 'water' ? 'Water' : 'Dry'})
                  </span>
                  <span className="font-medium text-slate-900">
                    ${((item.unit_price_cents || 0) / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
