import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PendingOrderCard } from './PendingOrderCard';
import { supabase } from '../../lib/supabase';

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

      // Check if the orderId looks like a partial ID (8 chars or less) or full UUID
      const isPartialId = orderId.length <= 8;

      let query = supabase
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
        `);

      if (isPartialId) {
        // For partial IDs, fetch all orders and filter client-side
        // UUID columns don't support pattern matching directly in PostgreSQL
        const { data: orders, error: searchError } = await supabase
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
          `);

        if (searchError) throw searchError;

        // Filter results to find the matching order
        const matchingOrder = orders?.find(o =>
          o.id.toLowerCase().startsWith(orderId.toLowerCase())
        );

        if (!matchingOrder) {
          setError('Order not found');
          return;
        }

        setOrder(matchingOrder);
        setLoading(false);
        return;
      } else {
        // For full UUIDs, do exact match
        query = query.eq('id', orderId);
      }

      const { data, error: orderError } = await query.maybeSingle();

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

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Orders
      </button>

      <PendingOrderCard order={order} onUpdate={handleUpdate} openEditMode={openEditMode} />
    </div>
  );
}
