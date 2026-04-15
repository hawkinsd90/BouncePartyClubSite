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
      const { data, error: dbError } = await supabase
        .from('invoice_links' as any)
        .select('order_id, link_token, expires_at')
        .eq('short_code', shortCode)
        .maybeSingle();

      if (dbError || !data) {
        setError(true);
        return;
      }

      if (data.expires_at && new Date(data.expires_at) < new Date()) {
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
            This link is invalid or has expired. Please contact us for a new link.
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
        <p className="text-slate-600">Loading your invoice...</p>
      </div>
    </div>
  );
}
