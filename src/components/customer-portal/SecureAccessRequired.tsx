import { useState } from 'react';
import { PhoneLink } from '../shared/PhoneLink';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const SECURE_LINK_REQUEST_MESSAGE =
  'If we found your order, we sent a secure access link to the contact information on file.';

// Shown when the server will not release an order to this visitor (an old order-id-only link, an expired or revoked
// link, or someone else's order). It never says which: the visitor just asks for a fresh secure link. The request goes to
// request-portal-link, which only ever sends to the contact details already on the order and always answers the same way.
export function SecureAccessRequired({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function requestLink() {
    setState('sending');
    try {
      await supabase.functions.invoke('request-portal-link', { body: { orderId } });
    } catch {
      // The answer is the same whatever happened.
    }
    setState('sent');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="text-center bg-white rounded-2xl shadow-2xl p-6 sm:p-10 max-w-md border-2 border-slate-100">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <ShieldCheck className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">Secure access required</h1>
        {state === 'sent' ? (
          <p className="text-slate-600" role="status">{SECURE_LINK_REQUEST_MESSAGE}</p>
        ) : (
          <>
            <p className="text-slate-600 mb-6">We need to verify your secure access link.</p>
            <button
              type="button"
              onClick={requestLink}
              disabled={state === 'sending'}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {state === 'sending' ? 'Sending…' : 'Send me a secure link'}
            </button>
          </>
        )}
        <p className="text-slate-500 text-sm font-semibold mt-6"><PhoneLink phone="(313) 889-3860" /></p>
      </div>
    </div>
  );
}
