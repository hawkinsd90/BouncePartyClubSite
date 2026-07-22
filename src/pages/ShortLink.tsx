import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function ShortLink() {
  const { shortCode } = useParams<{ shortCode: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shortCode) {
      setError(true);
      return;
    }

    (async () => {
      const { data, error: rpcError } = await supabase.rpc('resolve_portal_short_link' as any, {
        p_short_code: shortCode,
      }) as any;

      if (rpcError || !data?.found) {
        setError(true);
        return;
      }

      if (data.link_type === 'invoice' && data.invoice_token) {
        window.location.replace(
          `/customer-portal/${data.order_id}?t=${data.invoice_token}`
        );
      } else {
        window.location.replace(
          `/customer-portal/${data.order_id}`
        );
      }
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
