import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface OrderDetails {
  id: string;
  event_date: string;
  deposit_due_cents: number;
  balance_due_cents: number;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
}

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);

  // Helper: send SMS + email only once per order
  async function sendNotificationsIfNeeded(order: OrderDetails) {
    const orderId = order.id;

    try {
      // 1) Check if we've already queued/sent a booking confirmation message
      const { data: existingMessage, error: checkError } = await supabase
        .from('messages')
        .select('id')
        .eq('order_id', orderId)
        .eq('template_key', 'booking_request_confirmation')
        .maybeSingle();

      if (checkError) {
        console.error('[PAYMENT-COMPLETE] Error checking existing messages:', checkError);
      }

      if (existingMessage) {
        console.log('[PAYMENT-COMPLETE] Notifications already queued for this order. Skipping.');
        return;
      }

      console.log('[PAYMENT-COMPLETE] No prior confirmation message found. Creating new email + SMS.');

      const fullName = `${order.customer.first_name} ${order.customer.last_name}`.trim();
      const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString(
        'en-US',
        {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }
      );

      // 2) Create email payload (stored in messages table; your backend mailer sends it)
      const emailPayload = {
        subject: 'We received your Bounce Party Club booking request!',
        greeting: `Hi ${fullName},`,
        intro:
          'Thanks for booking with Bounce Party Club! This email confirms that we’ve received your booking request and are reviewing the details.',
        event_summary: {
          event_date: eventDateStr,
          deposit_amount: (order.deposit_due_cents / 100).toFixed(2),
          balance_due: (order.balance_due_cents / 100).toFixed(2),
          order_id: order.id.slice(0, 8).toUpperCase(),
        },
        next_steps: [
          'Our team will review your event details and confirm availability.',
          'You’ll receive a follow-up message within 24 hours with your delivery window and final confirmation.',
          'Your card will only be charged for the deposit once your booking is approved.',
        ],
        footer: {
          phone: '(313) 889-3860',
          address: '4426 Woodward Ave, Wayne, MI 48184',
          tagline: 'Thank you for choosing Bounce Party Club to bring energy and excitement to your event!',
        },
      };

      const { error: insertMsgError } = await supabase.from('messages').insert({
        order_id: orderId,
        to_email: order.customer.email,
        channel: 'email',
        template_key: 'booking_request_confirmation',
        payload_json: emailPayload,
        status: 'pending',
      });

      if (insertMsgError) {
        console.error('[PAYMENT-COMPLETE] Error inserting booking confirmation email message:', insertMsgError);
      } else {
        console.log('[PAYMENT-COMPLETE] Booking confirmation email message queued.');
      }

      // 3) Send SMS via edge function (best-effort; don’t break UI if it fails)
      if (order.customer.phone) {
        const smsMessage =
          `Hi ${order.customer.first_name}, we received your Bounce Party Club booking request for ${eventDateStr}. ` +
          `We’ll review it and confirm within 24 hours. Your deposit will only be charged once your booking is approved. ` +
          `- Bounce Party Club`;

        try {
          const smsApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
          const smsResponse = await fetch(smsApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: order.customer.phone,
              message: smsMessage,
              orderId: orderId,
            }),
          });

          if (!smsResponse.ok) {
            const smsText = await smsResponse.text();
            console.error('[PAYMENT-COMPLETE] SMS notification failed:', smsText);
          } else {
            console.log('[PAYMENT-COMPLETE] SMS notification sent successfully.');
          }
        } catch (smsErr) {
          console.error('[PAYMENT-COMPLETE] Error sending SMS notification:', smsErr);
        }
      } else {
        console.log('[PAYMENT-COMPLETE] No phone number on file; SMS not sent.');
      }
    } catch (outerErr) {
      console.error('[PAYMENT-COMPLETE] Error in sendNotificationsIfNeeded:', outerErr);
    }
  }

  useEffect(() => {
    const updateOrder = async () => {
      console.log('� [PAYMENT-COMPLETE] Component mounted');

      const orderId = searchParams.get('orderId');
      const sessionId = searchParams.get('session_id');

      console.log('� [PAYMENT-COMPLETE] Order ID:', orderId);
      console.log('� [PAYMENT-COMPLETE] Session ID:', sessionId);

      if (!orderId) {
        console.error('❌ [PAYMENT-COMPLETE] No order ID in URL');
        setError('No order ID provided');
        setStatus('error');
        return;
      }

      try {
        setStatus('loading');

        console.log('� [PAYMENT-COMPLETE] Calling stripe-checkout edge function (webhook mode)...');

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/stripe-checkout?action=webhook&orderId=${orderId}&session_id=${sessionId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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

        // Fetch fresh order details for display + notifications
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select(
            `
            id,
            event_date,
            deposit_due_cents,
            balance_due_cents,
            customer:customers!customer_id (
              first_name,
              last_name,
              email,
              phone
            )
          `
          )
          .eq('id', orderId)
          .single();

        if (orderError) {
          console.error('❌ [PAYMENT-COMPLETE] Error fetching order:', orderError);
        } else {
          const typedOrder = order as unknown as OrderDetails;
          setOrderDetails(typedOrder);

          // Send SMS + email exactly once per order
          await sendNotificationsIfNeeded(typedOrder);
        }

        setStatus('success');

        // Close window after short delay
        setTimeout(() => {
          console.log('� [PAYMENT-COMPLETE] Closing window...');
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

  // LOADING UI
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
          <h1 className="text-xl font-semibold text-slate-900 mb-2">
            Finalizing your booking…
          </h1>
          <p className="text-slate-600 text-sm">
            We’re confirming your card details and saving your booking request. This only takes a
            moment.
          </p>
        </div>
      </div>
    );
  }

  // ERROR UI
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

  // SUCCESS UI
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="bg-white max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mb-4">Request Received!</h1>

          <p className="text-slate-600 mb-6">
            Thank you for choosing Bounce Party Club. Your booking request has been submitted and is now
            pending admin review for final confirmation. Your deposit will be processed once your
            booking is approved.
          </p>
        </div>

        {orderDetails && (
          <div className="space-y-6 mb-8">
            <div className="grid grid-cols-2 gap-4 p-6 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm text-slate-600 mb-1">Order ID:</p>
                <p className="font-semibold text-slate-900">
                  {orderDetails.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Event Date:</p>
                <p className="font-semibold text-slate-900">
                  {new Date(orderDetails.event_date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Deposit:</p>
                <p className="font-semibold text-green-600">
                  ${(orderDetails.deposit_due_cents / 100).toFixed(2)}
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
                A confirmation email has been queued for{' '}
                <span className="font-semibold">{orderDetails.customer?.email}</span>. Please allow a
                few minutes for it to arrive.
              </p>
            </div>

            <div className="p-6 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-700 leading-relaxed mb-3">
                Our admin team will review your booking request and contact you within 24 hours to
                confirm your delivery time window and finalize your reservation details.
              </p>
              <p className="text-sm text-slate-600">
                If you have any questions, contact us at{' '}
                <span className="font-semibold">(313) 889-3860</span> or visit us at{' '}
                <span className="font-semibold">4426 Woodward Ave, Wayne, MI 48184</span>.
              </p>
            </div>
          </div>
        )}

        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900 mb-6">Thank You!</p>
          <p className="text-sm text-slate-500 italic">
            Thank you for choosing Bounce Party Club to bring energy and excitement to your event.
            If you have any questions, contact us at (313) 889-3860.
          </p>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400">This window will close automatically...</p>
        </div>
      </div>
    </div>
  );
}
