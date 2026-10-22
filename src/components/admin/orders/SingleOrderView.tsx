import { useState, useEffect, useRef } from 'react';
import { buildPortalPath } from '../../../lib/portal/portalToken';
import { ArrowLeft, Copy, Check, ExternalLink, Link } from 'lucide-react';
import { PendingOrderCard } from './PendingOrderCard';
import { AdminFloatingOrderHeader } from './AdminFloatingOrderHeader';
import { supabase } from '../../../lib/supabase';
import { ORDER_STATUS } from '../../../lib/constants/statuses';
import { createShortPortalLink } from '../../../lib/portal/portalShortLink';

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
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [shortLinkCopied, setShortLinkCopied] = useState(false);
  const [generatingShortLink, setGeneratingShortLink] = useState(false);
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
        const { data: matchId, error: searchError } = await supabase
          .rpc('find_order_id_by_prefix', { p_prefix: orderId });

        if (searchError) throw searchError;

        if (!matchId) {
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
          .eq('id', matchId)
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

  useEffect(() => {
    if (!order) return;
    (async () => {
      const { data } = await supabase
        .from('invoice_links' as any)
        .select('short_code')
        .eq('order_id', order.id)
        .eq('link_type', 'portal')
        .is('revoked_at', null)
        .not('short_code', 'is', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.short_code) {
        setShortUrl(`${window.location.origin}/i/${data.short_code}`);
      }
    })();
  }, [order?.id]);

  async function handleShortLink() {
    setGeneratingShortLink(true);
    let url = shortUrl;
    try {
      if (!url) {
        // Re-check DB for an active link in case state hasn't loaded yet
        const { data: existing } = await supabase
          .from('invoice_links' as any)
          .select('short_code')
          .eq('order_id', order.id)
          .eq('link_type', 'portal')
        .is('revoked_at', null)
          .not('short_code', 'is', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.short_code) {
          url = `${window.location.origin}/i/${existing.short_code}`;
        } else {
          const linkResult = await createShortPortalLink(order.id, supabase, order.event_date);
          if (!linkResult.success) {
            throw new Error(linkResult.error);
          }
          url = linkResult.url;
        }
        setShortUrl(url);
      }
      await navigator.clipboard.writeText(url);
      setShortLinkCopied(true);
      setTimeout(() => setShortLinkCopied(false), 2000);
    } catch {
      // clipboard fallback (url is the link just made or found, which state may not hold yet)
      if (url) {
        const el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        setShortLinkCopied(true);
        setTimeout(() => setShortLinkCopied(false), 2000);
      }
    } finally {
      setGeneratingShortLink(false);
    }
  }

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

  if (loading && !order) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-600">Loading order...</div>
      </div>
    );
  }

  if (!order) {
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
    <div className={showFloatingHeader ? 'pt-[calc(var(--site-header-height)_+_1rem)]' : ''}>
      <AdminFloatingOrderHeader
        order={order}
        isVisible={showFloatingHeader}
        onEditClick={handleEditFromFloatingHeader}
      />

      <div className="space-y-4">
        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-800">
            The order could not be refreshed ({error}). What you see may be out of date.
            <button type="button" onClick={() => { void loadOrder(); }} className="ml-2 font-semibold underline min-h-[44px]">Try again</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center min-h-[44px] text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Orders
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 max-w-full min-w-0">
              <span className="text-xs text-slate-500 font-medium select-none">UUID</span>
              <span className="font-mono text-xs text-slate-700 select-all break-all min-w-0">{order.id}</span>
              <button
                onClick={handleCopyUUID}
                title="Copy UUID"
                aria-label="Copy order UUID"
                className="ml-1 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 rounded text-slate-400 hover:text-slate-700 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <a
              href={buildPortalPath(order.id, { token: portalToken })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-sm font-medium rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Customer Portal
            </a>

            <div className="flex flex-col items-start sm:items-end gap-0.5 min-w-0">
              <button
                onClick={handleShortLink}
                disabled={generatingShortLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] bg-white border border-slate-300 hover:border-teal-400 hover:bg-teal-50 text-slate-700 hover:text-teal-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {shortLinkCopied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Link className="w-3.5 h-3.5" />
                )}
                {shortLinkCopied ? 'Copied!' : generatingShortLink ? 'Generating...' : 'Copy Link'}
              </button>
              {shortUrl && (
                <span className="text-xs text-slate-400 font-mono truncate max-w-full sm:max-w-[220px]">{shortUrl}</span>
              )}
            </div>
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
