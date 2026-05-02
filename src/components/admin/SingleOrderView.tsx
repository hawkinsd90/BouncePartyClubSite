import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Copy, Check, ExternalLink } from 'lucide-react';
import { PendingOrderCard } from './PendingOrderCard';
import { AdminFloatingOrderHeader } from './AdminFloatingOrderHeader';
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
  const [showFloatingHeader, setShowFloatingHeader] = useState(false);
  const [copied, setCopied] = useState(false);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const cardRef = useRef<{ card: HTMLElement, actionButtons: HTMLElement | null, openEdit: () => void } | null>(null);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    try {
      setLoading(true);
      setError(null);

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
        const { data: matchRow, error: searchError } = await supabase
          .from('orders')
          .select('id')
          .ilike('id', `${orderId}%`)
          .limit(1)
          .maybeSingle();

        if (searchError) throw searchError;

        if (!matchRow) {
          setError('Order not found');
          setLoading(false);
          return;
        }

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
          .eq('id', matchRow.id)
          .maybeSingle();

        if (fullOrderError) throw fullOrderError;

        setOrder(fullOrder);
        setLoading(false);
        return;
      } else {
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
    if (!order || order.status !== ORDER_STATUS.DRAFT) {
      setPortalToken(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('invoice_links' as any)
        .select('link_token')
        .eq('order_id', order.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setPortalToken(data?.link_token ?? null);
    })();
  }, [order?.id, order?.status]);

  async function handleCopyUUID() {
    if (!order?.id) return;
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = order.id;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  useEffect(() => {
    if (!order) {
      setShowFloatingHeader(false);
      return;
    }

    let rafId: number | null = null;

    function computeFloatingHeader() {
      if (!cardRef.current) {
        setShowFloatingHeader(false);
        return;
      }

      const { card, actionButtons } = cardRef.current;
      const cardRect = card.getBoundingClientRect();

      const triggerElement = actionButtons || card;
      const triggerRect = triggerElement.getBoundingClientRect();

      const hasScrolledPastTop = cardRect.top < 64;
      const actionButtonsVisible = triggerRect.bottom > 64;

      setShowFloatingHeader(hasScrolledPastTop && actionButtonsVisible);
    }

    function handleScroll() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeFloatingHeader();
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    computeFloatingHeader();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-slate-500 font-medium select-none">UUID</span>
              <span className="font-mono text-xs text-slate-700 select-all">{order.id}</span>
              <button
                onClick={handleCopyUUID}
                title="Copy UUID"
                className="ml-1 p-0.5 rounded text-slate-400 hover:text-slate-700 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <a
              href={portalToken ? `/customer-portal/${order.id}?t=${portalToken}` : `/customer-portal/${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-sm font-medium rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Customer Portal
            </a>
          </div>
        </div>

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
