import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Home } from 'lucide-react';

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
  const navigate = useNavigate();
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

      // 2) Send formatted HTML email via Resend
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Booking Request Received - Bounce Party Club</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 30px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Bounce Party Club</h1>
                      <p style="margin: 10px 0 0; color: #e0f2fe; font-size: 16px;">Request Received!</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px 30px;">
                      <h2 style="margin: 0 0 20px; color: #1e293b; font-size: 24px;">Hi ${fullName},</h2>
                      <p style="margin: 0 0 20px; color: #475569; font-size: 16px; line-height: 1.6;">
                        Thank you for choosing Bounce Party Club! We've received your booking request and are reviewing the details.
                      </p>

                      <div style="background-color: #f8fafc; border-radius: 8px; padding: 24px; margin: 30px 0;">
                        <h3 style="margin: 0 0 16px; color: #1e293b; font-size: 18px; font-weight: 600;">Event Summary</h3>
                        <table width="100%" cellpadding="8" cellspacing="0">
                          <tr>
                            <td style="color: #64748b; font-size: 14px; padding: 8px 0;">Order ID:</td>
                            <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; padding: 8px 0;">${order.id.slice(0, 8).toUpperCase()}</td>
                          </tr>
                          <tr>
                            <td style="color: #64748b; font-size: 14px; padding: 8px 0;">Event Date:</td>
                            <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; padding: 8px 0;">${eventDateStr}</td>
                          </tr>
                          <tr>
                            <td style="color: #64748b; font-size: 14px; padding: 8px 0;">Deposit:</td>
                            <td style="color: #10b981; font-size: 14px; font-weight: 600; text-align: right; padding: 8px 0;">$${(order.deposit_due_cents / 100).toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td style="color: #64748b; font-size: 14px; padding: 8px 0;">Balance Due:</td>
                            <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; padding: 8px 0;">$${(order.balance_due_cents / 100).toFixed(2)}</td>
                          </tr>
                        </table>
                      </div>

                      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 30px 0; border-radius: 4px;">
                        <h3 style="margin: 0 0 12px; color: #1e40af; font-size: 16px; font-weight: 600;">Next Steps</h3>
                        <ul style="margin: 0; padding-left: 20px; color: #1e40af; font-size: 14px; line-height: 1.8;">
                          <li>Our team will review your event details and confirm availability.</li>
                          <li>You'll receive a follow-up message within 24 hours with your delivery window and final confirmation.</li>
                          <li>Your card will only be charged for the deposit once your booking is approved.</li>
                        </ul>
                      </div>

                      <p style="margin: 30px 0 0; color: #475569; font-size: 14px; line-height: 1.6;">
                        If you have any questions, please don't hesitate to reach out to us at <strong style="color: #1e293b;">(313) 889-3860</strong> or visit us at <strong style="color: #1e293b;">4426 Woodward Ave, Wayne, MI 48184</strong>.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="margin: 0 0 10px; color: #64748b; font-size: 14px; font-weight: 600;">Bounce Party Club</p>
                      <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.6;">
                        Thank you for choosing Bounce Party Club to bring energy and excitement to your event!
                      </p>
                      <p style="margin: 15px 0 0; color: #94a3b8; font-size: 12px;">
                        (313) 889-3860 | 4426 Woodward Ave, Wayne, MI 48184
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      try {
        const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
        const emailResponse = await fetch(emailApiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: order.customer.email,
            subject: '✅ We received your Bounce Party Club booking request!',
            html: emailHtml,
          }),
        });

        if (!emailResponse.ok) {
          const emailText = await emailResponse.text();
          console.error('[PAYMENT-COMPLETE] Email notification failed:', emailText);
        } else {
          console.log('[PAYMENT-COMPLETE] Email notification sent successfully.');
        }
      } catch (emailErr) {
        console.error('[PAYMENT-COMPLETE] Error sending email notification:', emailErr);
      }

      // 3) Send SMS to CUSTOMER via edge function (best-effort)
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

      // 4) Send SMS notification to ADMIN
      try {
        const { data: adminSettings, error: adminError } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_notification_phone')
          .maybeSingle();

        if (adminError) {
          console.error('[PAYMENT-COMPLETE] Error fetching admin_notification_phone:', adminError);
        } else if (adminSettings?.value) {
          const adminPhone = adminSettings.value as string;

          const adminSmsMessage =
            `NEW BOOKING! ${order.customer.first_name} ${order.customer.last_name} ` +
            `for ${eventDateStr}. Review in admin panel. ` +
            `Order #${order.id.slice(0, 8).toUpperCase()}`;


          const smsApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
          const adminSmsResponse = await fetch(smsApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: adminPhone,
              message: adminSmsMessage,
              orderId: orderId,
            }),
          });

          if (!adminSmsResponse.ok) {
            const text = await adminSmsResponse.text();
            console.error('[PAYMENT-COMPLETE] Admin SMS failed:', text);
          } else {
            console.log('[PAYMENT-COMPLETE] Admin SMS notification sent.');
          }
        } else {
          console.log('[PAYMENT-COMPLETE] No admin_notification_phone configured; skipping admin SMS.');
        }

        // Also send admin email
        const { data: adminEmailSettings } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_email')
          .maybeSingle();

        if (adminEmailSettings?.value) {
          const adminEmail = adminEmailSettings.value as string;
          const adminEmailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>New Booking Request</title>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f3f4f6;">
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #dc2626; margin: 0 0 20px;">🎉 New Booking Request!</h2>
                <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
                  <h3 style="margin: 0 0 10px; color: #991b1b;">Customer Information</h3>
                  <p style="margin: 5px 0;"><strong>Name:</strong> ${order.customer.first_name} ${order.customer.last_name}</p>
                  <p style="margin: 5px 0;"><strong>Email:</strong> ${order.customer.email}</p>
                  ${order.customer.phone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${order.customer.phone}</p>` : ''}
                </div>
                <div style="background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                  <h3 style="margin: 0 0 10px; color: #1e40af;">Event Details</h3>
                  <p style="margin: 5px 0;"><strong>Order ID:</strong> ${order.id.slice(0, 8).toUpperCase()}</p>
                  <p style="margin: 5px 0;"><strong>Event Date:</strong> ${eventDateStr}</p>
                  <p style="margin: 5px 0;"><strong>Deposit:</strong> $${(order.deposit_due_cents / 100).toFixed(2)}</p>
                  <p style="margin: 5px 0;"><strong>Balance Due:</strong> $${(order.balance_due_cents / 100).toFixed(2)}</p>
                </div>
                <p style="margin: 30px 0 0; padding: 20px; background-color: #fffbeb; border-radius: 6px; color: #92400e;">
                  <strong>Action Required:</strong> Please review this booking request in the admin panel and confirm availability.
                </p>
              </div>
            </body>
            </html>
          `;

          try {
            const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
            const adminEmailResponse = await fetch(emailApiUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: adminEmail,
                subject: `🎉 New Booking Request - Order #${order.id.slice(0, 8).toUpperCase()}`,
                html: adminEmailHtml,
              }),
            });

            if (!adminEmailResponse.ok) {
              const text = await adminEmailResponse.text();
              console.error('[PAYMENT-COMPLETE] Admin email failed:', text);
            } else {
              console.log('[PAYMENT-COMPLETE] Admin email notification sent.');
            }
          } catch (emailErr) {
            console.error('[PAYMENT-COMPLETE] Error sending admin email:', emailErr);
          }
        }
      } catch (adminErr) {
        console.error('[PAYMENT-COMPLETE] Error sending admin SMS:', adminErr);
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
          `${supabaseUrl}/functions/v1/stripe-checkout?action=webhook&orderId=${orderId}&session_id=${encodeURIComponent(sessionId ?? '')

          }`,
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

        // Clear cart and order data from localStorage
        console.log('� [PAYMENT-COMPLETE] Clearing localStorage data...');
        localStorage.removeItem('bpc_cart');
        localStorage.removeItem('bpc_quote_form');
        localStorage.removeItem('bpc_price_breakdown');
        localStorage.removeItem('bpc_contact_data');
        localStorage.removeItem('test_booking_tip');

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
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            <Home className="w-5 h-5" />
            Back to Home
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-slate-400">This window will close automatically...</p>
        </div>
      </div>
    </div>
  );
}
