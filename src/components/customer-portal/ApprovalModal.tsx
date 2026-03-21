import { useState, useEffect, useRef } from 'react';
import {
  CreditCard,
  CreditCard as Edit2,
  MapPin,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { formatOrderId } from '../../lib/utils';
import { format } from 'date-fns';
import { formatCurrency } from '../../lib/pricing';
import { checkMultipleUnitsAvailability } from '../../lib/availability';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
  selectedPaymentCents: number;
  selectedPaymentBaseCents: number;
  newTipCents: number;
  keepOriginalPayment: boolean;
  paymentAmount: 'deposit' | 'full' | 'custom';
  customPaymentAmount?: string;
  orderTotalCents?: number;
}

export function ApprovalModal({
  isOpen,
  onClose,
  order,
  onSuccess,
  selectedPaymentCents,
  selectedPaymentBaseCents,
  newTipCents,
  keepOriginalPayment,
  paymentAmount,
  customPaymentAmount = '',
  orderTotalCents,
}: ApprovalModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cardDeclined, setCardDeclined] = useState(false);
  const [declineMessage, setDeclineMessage] = useState('');
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function checkAvailability(): Promise<boolean> {
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('unit_id')
      .eq('order_id', order.id);

    if (!orderItems || orderItems.length === 0) return true;

    const checks = orderItems.map((item: any) => ({
      unitId: item.unit_id,
      eventStartDate: order.event_date,
      eventEndDate: order.event_end_date || order.event_date,
      excludeOrderId: order.id,
    }));

    const results = await checkMultipleUnitsAvailability(checks);
    const unavailable = results.filter((r) => !r.isAvailable);
    if (unavailable.length > 0) {
      showToast(
        'Sorry, one or more items in your order are no longer available for your event date. Please contact us to reschedule.',
        'error'
      );
      return false;
    }
    return true;
  }

  async function handleUpdateCard() {
    setUpdatingCard(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
        'stripe-checkout',
        {
          body: {
            orderId: order.id,
            setupMode: true,
            paymentState: {
              paymentAmount,
              customPaymentAmount,
              newTipCents,
              keepOriginalPayment,
              selectedPaymentBaseCents,
            },
          },
        }
      );

      if (sessionError || !sessionData?.url) {
        throw new Error(sessionError?.message || 'Failed to create checkout session');
      }

      window.location.href = sessionData.url;
    } catch (error: any) {
      console.error('Error updating card:', error);
      showToast('Failed to update payment method. Please try again.', 'error');
      setUpdatingCard(false);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);

    try {
      const available = await checkAvailability();
      if (!available) {
        setSubmitting(false);
        return;
      }

      const resolvedPaymentType: string = keepOriginalPayment
        ? (order.customer_selected_payment_type || 'deposit')
        : paymentAmount;

      const alreadyPaidDeposit =
        order.stripe_payment_status === 'paid' ||
        (order.deposit_paid_cents || 0) > 0;

      if (alreadyPaidDeposit) {
        // Already paid — persist payment selection and confirm without charging.
        // Only write tip_cents when the customer has actively selected a positive tip.
        // Do not overwrite an existing stored tip with 0 through this flow.
        const updatePayload: Record<string, unknown> = {
          customer_selected_payment_cents: selectedPaymentBaseCents,
          customer_selected_payment_type: resolvedPaymentType,
          status: 'confirmed',
        };

        if (!keepOriginalPayment && newTipCents > 0) {
          updatePayload.tip_cents = newTipCents;
        }

        const { error: statusError } = await supabase
          .from('orders')
          .update(updatePayload)
          .eq('id', order.id);

        if (statusError) {
          throw new Error(statusError.message || 'Failed to update order status');
        }

        showToast(
          'Order approved successfully! Any changes will be added to your final balance.',
          'success'
        );
      } else if (selectedPaymentBaseCents <= 0) {
        // Deposit is $0 — no charge should happen today.
        // Require a valid saved card before confirming — we tell the customer their
        // card is kept on file, so one must actually exist.
        if (!hasValidCardOnFile) {
          showToast(
            'Please add a payment method before confirming. Your card will be kept on file for the final payment.',
            'error'
          );
          if (isMountedRef.current) setSubmitting(false);
          return;
        }

        // Tip deferred: store tip_cents on the order so it can be collected at
        // final payment. UI already explains "tip collected at your event".
        const updatePayload: Record<string, unknown> = {
          customer_selected_payment_cents: 0,
          customer_selected_payment_type: resolvedPaymentType,
          status: 'confirmed',
        };

        if (!keepOriginalPayment && newTipCents > 0) {
          updatePayload.tip_cents = newTipCents;
        }

        const { error: zeroDepositError } = await supabase
          .from('orders')
          .update(updatePayload)
          .eq('id', order.id);

        if (zeroDepositError) {
          throw new Error(zeroDepositError.message || 'Failed to confirm order');
        }

        // Send confirmation notification via edge function (fire-and-forget — non-fatal)
        try {
          const { data: fullOrder } = await supabase
            .from('orders')
            .select('*, customers(*), addresses(*)')
            .eq('id', order.id)
            .maybeSingle();

          const customer = fullOrder?.customers as any;
          const address = fullOrder?.addresses as any;

          if (customer?.email) {
            const firstName = customer.first_name || 'Customer';
            const shortId = formatOrderId(order.id);
            const eventDateStr = order.event_date
              ? format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')
              : '';
            const addressStr = address
              ? `${address.line1}, ${address.city}, ${address.state}`
              : '';

            const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #d1fae5;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #6ee7b7;background-color:#ecfdf5;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;color:#065f46;font-size:24px;font-weight:bold;">Booking Confirmed!</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px;">
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">
        Your order <strong>#${shortId}</strong> has been confirmed.
        No deposit is required today — your card will be kept on file for the final payment due at your event.
      </p>
      ${eventDateStr ? `<p style="margin:0 0 8px;color:#374151;font-size:15px;"><strong>Event Date:</strong> ${eventDateStr}</p>` : ''}
      ${addressStr ? `<p style="margin:0 0 16px;color:#374151;font-size:15px;"><strong>Location:</strong> ${addressStr}</p>` : ''}
      ${newTipCents > 0 ? `<p style="margin:0 0 16px;color:#374151;font-size:15px;">A crew tip of <strong>$${(newTipCents / 100).toFixed(2)}</strong> will be collected with the final payment.</p>` : ''}
      <p style="margin:0;color:#6b7280;font-size:13px;text-align:center;">Questions? Call us at (313) 889-3860.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body></html>`;

            await supabase.functions.invoke('send-email', {
              body: {
                to: customer.email,
                subject: `Booking Confirmed - Order #${shortId}`,
                html: emailHtml,
              },
            });
          }
        } catch (notifyErr) {
          console.error('Zero-deposit confirmation notification failed (non-fatal):', notifyErr);
        }

        showToast(
          'Booking confirmed! Your card will be kept on file for the final payment due at your event.',
          'success'
        );
      } else {
        // Customer hasn't paid yet and deposit > $0 — send all charge params in the request body.
        // charge-deposit uses these as source of truth; no pre-charge DB write needed.
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        const chargeResponse = await fetch(
          `${supabaseUrl}/functions/v1/charge-deposit`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken || anonKey}`,
              'Apikey': anonKey,
            },
            body: JSON.stringify({
              orderId: order.id,
              paymentAmountCents: selectedPaymentBaseCents,
              tipCents: keepOriginalPayment ? (order.tip_cents || 0) : newTipCents,
              selectedPaymentType: resolvedPaymentType,
            }),
          }
        );

        const chargeData = await chargeResponse.json();

        // chargeSucceeded means Stripe charged but a post-charge DB step failed.
        // Do NOT show the decline UI — the customer was charged successfully.
        if (!chargeData?.success && !chargeData?.chargeSucceeded) {
          const errMsg =
            chargeData?.error ||
            'Your card was declined. Please update your payment information and try again.';

          if (isMountedRef.current) {
            setDeclineMessage(errMsg);
            setCardDeclined(true);
            setSubmitting(false);
          }
          return;
        }

        if (chargeData?.chargeSucceeded && !chargeData?.success) {
          showToast(
            'Payment processed successfully! If your order status does not update shortly, please contact us.',
            'success'
          );
        } else {
          showToast('Order approved and payment processed successfully!', 'success');
        }
      }

      if (isMountedRef.current) {
        setSubmitting(false);
      }
      onClose();

      setTimeout(() => {
        onSuccess();
      }, 100);
    } catch (error: any) {
      console.error('Error approving order:', error);
      showToast(error.message || 'Failed to approve order. Please try again.', 'error');

      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();

  const address = order.addresses
    ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state} ${order.addresses.zip}`
    : 'No address';

  const eventDate = order.event_date
    ? format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')
    : 'No date';

  const currentTotalCents = orderTotalCents ?? (
    (order.subtotal_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.tax_cents || 0)
  );

  const lastFour =
    order.payment_method_last_four ||
    order.payments?.find((p: any) => p.payment_last4)?.payment_last4 ||
    null;

  const brand =
    order.payment_method_brand ||
    order.payments?.find((p: any) => p.payment_brand)?.payment_brand ||
    null;

  const paymentMethodText = lastFour && brand
    ? `${brand.charAt(0).toUpperCase() + brand.slice(1)} •••• ${lastFour}`
    : lastFour
      ? `Card •••• ${lastFour}`
      : null;

  const alreadyPaidDeposit =
    order.stripe_payment_status === 'paid' ||
    (order.deposit_paid_cents || 0) > 0;

  const hasValidCardOnFile = !!(order.stripe_customer_id && order.stripe_payment_method_id);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 md:p-5">
          <h3 className="text-lg md:text-xl font-bold text-green-900 mb-2">
            Approve Order Changes
          </h3>
          <p className="text-xs md:text-sm text-slate-600 mb-3">
            Review and confirm the updated order details below.
          </p>

          <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-2">
              <div>
                <p className="text-xs text-slate-500">Order #</p>
                <p className="font-mono text-sm font-semibold text-slate-900">
                  {formatOrderId(order.id)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">
                  {alreadyPaidDeposit || selectedPaymentBaseCents <= 0
                    ? 'Total Amount'
                    : 'Charging Now'}
                </p>
                <p className="text-lg font-bold text-green-700">
                  {formatCurrency(selectedPaymentCents)}
                </p>
              </div>
            </div>

            <div className="mb-2">
              <p className="text-xs text-slate-500">Customer</p>
              <p className="text-sm font-medium text-slate-900">{customerName}</p>
            </div>

            <div className="flex items-start gap-1.5 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-900 break-words">{address}</p>
              </div>
            </div>

            <div className="flex items-start gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-slate-900">{eventDate}</p>
            </div>
          </div>

          {(order.stripe_payment_method_id || paymentMethodText) && (
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <CreditCard className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900">
                      Payment Method on File
                    </p>
                    {paymentMethodText ? (
                      <p className="text-xs text-slate-700 font-medium">
                        {paymentMethodText}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600">Card saved for payment</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleUpdateCard}
                  disabled={updatingCard}
                  className="flex items-center text-blue-600 hover:text-blue-700 font-medium text-xs transition-colors whitespace-nowrap ml-2"
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1" />
                  {updatingCard ? 'Loading...' : 'Update'}
                </button>
              </div>
            </div>
          )}

          {selectedPaymentBaseCents <= 0 && !alreadyPaidDeposit ? (
            <>
              {hasValidCardOnFile ? (
                <div className="mb-3 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg">
                  <p className="text-sm font-semibold text-blue-900">No deposit required today</p>
                  <p className="text-xs text-blue-700 mt-1">
                    Your card will be kept on file for the final payment due at your event.
                    {newTipCents > 0 && ' Any tip you added will be collected with the final payment.'}
                  </p>
                </div>
              ) : (
                <div className="mb-3 p-3 bg-amber-50 border-2 border-amber-300 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Payment method required</p>
                      <p className="text-xs text-amber-800 mt-1">
                        No card is on file. Please add a payment method before confirming so we can collect the balance at your event.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleUpdateCard}
                    disabled={updatingCard}
                    className="mt-2 w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-4 h-4" />
                    {updatingCard ? 'Loading...' : 'Add Payment Method'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="mb-3 p-3 bg-green-50 border-2 border-green-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Payment Amount Selected</p>
                  <p className="text-2xl font-bold text-green-700">
                    {formatCurrency(selectedPaymentCents)}
                  </p>

                  {selectedPaymentBaseCents < currentTotalCents && (
                    <p className="text-xs text-slate-600 mt-1">
                      Balance due day of event:{' '}
                      {formatCurrency(currentTotalCents - selectedPaymentBaseCents)}
                    </p>
                  )}

                  {(keepOriginalPayment ? (order.tip_cents || 0) : newTipCents) > 0 && (
                    <p className="text-xs text-green-600 mt-0.5">
                      Includes{' '}
                      {formatCurrency(
                        keepOriginalPayment ? (order.tip_cents || 0) : newTipCents
                      )}{' '}
                      crew tip
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {cardDeclined && (
            <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-lg">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Payment Declined</p>
                  <p className="text-xs text-red-700 mt-0.5">{declineMessage}</p>
                </div>
              </div>

              <button
                onClick={handleUpdateCard}
                disabled={updatingCard}
                className="w-full mt-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                {updatingCard ? 'Loading...' : 'Update Payment Method'}
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={onClose}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>

            <button
              onClick={handleConfirm}
              disabled={submitting || (selectedPaymentBaseCents <= 0 && !alreadyPaidDeposit && !hasValidCardOnFile)}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {submitting
                ? 'Processing...'
                : selectedPaymentBaseCents <= 0 && !alreadyPaidDeposit
                ? 'Confirm Booking'
                : 'Confirm & Pay'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
