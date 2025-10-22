import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface OrderDetails {
  id: string;
  event_date: string;
  deposit_paid_cents: number;
  balance_due_cents: number;
  customer: {
    email: string;
  };
}

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);

  useEffect(() => {
    const updateOrder = async () => {
      console.log('💳 [PAYMENT-COMPLETE] Component mounted');

      const orderId = searchParams.get('orderId');
      const sessionId = searchParams.get('session_id');

      console.log('💳 [PAYMENT-COMPLETE] Order ID:', orderId);
      console.log('💳 [PAYMENT-COMPLETE] Session ID:', sessionId);

      if (!orderId) {
        console.error('❌ [PAYMENT-COMPLETE] No order ID in URL');
        setError('No order ID provided');
        setStatus('error');
        return;
      }

      try {
        console.log('📝 [PAYMENT-COMPLETE] Calling edge function to update order...');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/stripe-checkout?action=webhook&orderId=${orderId}&session_id=${sessionId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ [PAYMENT-COMPLETE] Edge function error:', errorText);
          setError('Failed to update order');
          setStatus('error');
          return;
        }

        const result = await response.json();
        console.log('✅ [PAYMENT-COMPLETE] Edge function response:', result);

        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('id, event_date, deposit_paid_cents, balance_due_cents, customer:customers!customer_id(email)')
          .eq('id', orderId)
          .single();

        if (orderError) {
          console.error('❌ [PAYMENT-COMPLETE] Error fetching order:', orderError);
        } else {
          setOrderDetails(order as any);
        }

        setStatus('success');

        setTimeout(() => {
          console.log('🔒 [PAYMENT-COMPLETE] Closing window...');
          window.close();
        }, 2000);
      } catch (err: any) {
        console.error('❌ [PAYMENT-COMPLETE] Error:', err);
        setError(err.message);
        setStatus('error');
      }
    };

    updateOrder();
  }, [searchParams]);

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Update Error</h2>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="bg-white max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mb-4">Payment Successful!</h1>

          <p className="text-slate-600 mb-6">
            Thank you for choosing Bounce Party Club. Your deposit has been paid and your booking is now pending admin review for final confirmation.
          </p>
        </div>

        {orderDetails && (
          <div className="space-y-6 mb-8">
            <div className="grid grid-cols-2 gap-4 p-6 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600 mb-1">Order ID:</p>
                <p className="font-semibold text-slate-900">{orderDetails.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Event Date:</p>
                <p className="font-semibold text-slate-900">
                  {new Date(orderDetails.event_date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Deposit Paid:</p>
                <p className="font-semibold text-green-600">
                  ${(orderDetails.deposit_paid_cents / 100).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Balance Due:</p>
                <p className="font-semibold text-slate-900">
                  ${(orderDetails.balance_due_cents / 100).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="p-6 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-sm text-blue-900 leading-relaxed">
                A confirmation email has been sent to <span className="font-semibold">{orderDetails.customer?.email}</span>
              </p>
            </div>

            <div className="p-6 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-700 leading-relaxed mb-3">
                Our admin team will review your booking request and contact you within 24 hours to confirm your delivery time window and finalize your reservation details.
              </p>
              <p className="text-sm text-slate-600">
                If you have any questions, contact us at <span className="font-semibold">(313) 889-3860</span> or visit us at <span className="font-semibold">4426 Woodward Ave, Wayne, MI 48184</span>.
              </p>
            </div>
          </div>
        )}

        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900 mb-6">Thank You!</p>
          <p className="text-sm text-slate-500 italic">
            Thank you for choosing Bounce Party Club to bring energy and excitement to your event. If you have any questions, contact us at (313) 889-3860.
          </p>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">This window will close automatically...</p>
        </div>
      </div>
    </div>
  );
}
