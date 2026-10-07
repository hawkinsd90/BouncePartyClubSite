import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { buildPortalPath } from '../lib/portalToken';

// /i/<shortCode>: the short code is a bearer credential. The server resolves it (rate limited, service role) and
// returns only the order id and, for order-bound proof links, the token. The token is then carried in the URL
// fragment (#t=...), which is not sent to any server and does not appear in Referer headers.
export function ShortLink() {
  const { shortCode } = useParams<{ shortCode: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shortCode) {
      setError(true);
      return;
    }

    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke('resolve-link', {
        body: { code: shortCode },
      });

      if (invokeError || !data?.found || typeof data.orderId !== 'string') {
        setError(true);
        return;
      }

      window.location.replace(buildPortalPath(data.orderId, { token: data.token ?? null }));
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
