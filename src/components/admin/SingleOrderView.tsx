import { useState, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PendingOrderCard } from './PendingOrderCard';
import { AdminFloatingOrderHeader } from './AdminFloatingOrderHeader';
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
  const [showFloatingHeader, setShowFloatingHeader] = useState(false);
  const cardRef = useRef<{ card: HTMLElement, actionButtons: HTMLElement | null, openEdit: () => void } | null>(null);

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
        // For partial IDs, first fetch only order IDs to find match
        const { data: orderIds, error: searchError } = await supabase
          .from('orders')
          .select('id');

        if (searchError) throw searchError;

        // Filter to find matching order ID
        const matchingId = orderIds?.find(o =>
          o.id.toLowerCase().startsWith(orderId.toLowerCase())
        )?.id;

        if (!matchingId) {
          setError('Order not found');
          setLoading(false);
          return;
        }

        // Now fetch the full order data with relations
        const { data: fullOrder, error: fullOrderError } = await supabase
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
          .eq('id', matchingId)
          .maybeSingle();

        if (fullOrderError) throw fullOrderError;

        setOrder(fullOrder);
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

  useEffect(() => {
    if (!order) {
      setShowFloatingHeader(false);
      return;
    }

    function handleScroll() {
      if (!cardRef.current) {
        setShowFloatingHeader(false);
        return;
      }

      const { card, actionButtons } = cardRef.current;
      const cardRect = card.getBoundingClientRect();

      // Use action buttons position if available, otherwise use card bottom
      const triggerElement = actionButtons || card;
      const triggerRect = triggerElement.getBoundingClientRect();

      // Header should appear only after we've scrolled past the top of the card
      const hasScrolledPastTop = cardRect.top < 64; // 64px = top-16 (header height)

      // Header should disappear when action buttons scroll out of view
      const actionButtonsVisible = triggerRect.bottom > 64;

      setShowFloatingHeader(hasScrolledPastTop && actionButtonsVisible);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [order]);

  function handleEditFromFloatingHeader() {
    if (cardRef.current) {
      cardRef.current.openEdit();
    }
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
    <div className={showFloatingHeader ? 'pt-20' : ''}>
      <AdminFloatingOrderHeader
        order={order}
        isVisible={showFloatingHeader}
        onEditClick={handleEditFromFloatingHeader}
      />

      <div className="space-y-4">
        <button
          onClick={onBack}
          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Orders
        </button>

        <PendingOrderCard
          ref={cardRef}
          order={order}
          onUpdate={handleUpdate}
          openEditMode={openEditMode}
        />
      </div>
    </div>
  );
}
