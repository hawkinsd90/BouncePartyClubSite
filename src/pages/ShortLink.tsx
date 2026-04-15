import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const TERMINAL_STATUSES = ['cancelled', 'void', 'completed'];
const POST_TERMINAL_GRACE_DAYS = 30;

function isLinkStillValid(orderStatus: string, cancelledAt: string | null, completedAt: string | null): boolean {
  if (!TERMINAL_STATUSES.includes(orderStatus)) return true;
  const terminalAt = cancelledAt || completedAt;
  if (!terminalAt) return true;
  const graceCutoff = new Date(terminalAt);
  graceCutoff.setDate(graceCutoff.getDate() + POST_TERMINAL_GRACE_DAYS);
  return new Date() <= graceCutoff;
}

export function ShortLink() {
  const { shortCode } = useParams<{ shortCode: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shortCode) {
      setError(true);
      return;
    }

    (async () => {
      const { data, error: dbError } = await supabase
        .from('invoice_links' as any)
        .select('order_id, link_token, expires_at')
        .eq('short_code', shortCode)
        .maybeSingle();

      if (dbError || !data) {
        setError(true);
        return;
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('status, cancelled_at, completed_at')
        .eq('id', data.order_id)
        .maybeSingle();

      if (orderError || !order) {
        setError(true);
        return;
      }

      if (!isLinkStillValid(order.status, order.cancelled_at, order.completed_at)) {
        setError(true);
        return;
      }

      window.location.replace(
        `/customer-portal/${data.order_id}?t=${data.link_token}`
      );
    })();
  }, [shortCode]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="text-center bg-white rounded-2xl shadow-2xl p-10 max-w-md border-2 border-slate-100">
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Link Not Found</h1>
          <p className="text-slate-600 mb-4">
            This link is no longer active. Please contact us if you need assistance.
          </p>
          <p className="text-slate-500 text-sm font-semibold">(313) 889-3860</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-slate-600">Loading your order...</p>
      </div>
    </div>
  );
}
