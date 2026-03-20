import { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, Printer, X, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { showToast } from '../../lib/notifications';
import { sendNotificationToCustomer } from '../../lib/notificationService';
import { TipSelector, calculateTipCents } from '../payment/TipSelector';
import { SimpleInvoiceDisplay } from '../shared/SimpleInvoiceDisplay';
import { CustomerInfoForm } from './CustomerInfoForm';
import { CardOnFileAuthorization } from '../payment/CardOnFileAuthorization';
import type { OrderSummaryDisplay } from '../../lib/orderSummary';

interface InvoiceAcceptanceViewProps {
  order: any;
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: any | null;
  orderSummary: OrderSummaryDisplay | null;
  onReload: () => void;
  onApprovalSuccess: () => void;
}

interface CustomerInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

export function InvoiceAcceptanceView({
  order,
  orderItems,
  invoiceLink,
  orderSummary,
  onReload,
  onApprovalSuccess,
}: InvoiceAcceptanceViewProps) {
  const hasCustomer = !!(order.customers?.first_name || order.customers?.email);
  const requireCardOnFile = order.require_card_on_file !== false;
  const depositDueCents = order.deposit_due_cents || 0;

  const [processing, setProcessing] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customPaymentAmount, setCustomPaymentAmount] = useState('');
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    first_name: order.customers?.first_name || '',
    last_name: order.customers?.last_name || '',
    email: order.customers?.email || '',
    phone: order.customers?.phone || '',
    business_name: order.customers?.business_name || '',
  });

  const totalCents =
    (order.subtotal_cents || 0) +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.tax_cents || 0) -
    (order.discount_cents || 0);

  const tipCents = calculateTipCents(tipAmount, customTipAmount, totalCents);

  const actualPaymentBaseCents = (() => {
    if (paymentAmount === 'full') return totalCents;
    if (paymentAmount === 'custom' && customPaymentAmount) {
      return Math.round(parseFloat(customPaymentAmount) * 100);
    }
    return depositDueCents;
  })();

  const actualPaymentCents = actualPaymentBaseCents + tipCents;

  function handlePrintInvoice() {
    window.print();
  }

  async function handleAccept() {
    if (!accepted) {
      showToast('Please review and accept the invoice terms.', 'error');
      return;
    }

    if (requireCardOnFile && !cardOnFileConsent) {
      showToast('Please accept the card-on-file authorization to continue.', 'error');
      return;
    }

    setProcessing(true);

    try {
      if (!hasCustomer) {
        if (!customerInfo.first_name || !customerInfo.last_name || !customerInfo.email || !customerInfo.phone) {
          showToast('Please fill in all required fields.', 'error');
          setProcessing(false);
          return;
        }

        const { error: customerError } = await supabase
          .from('customers')
          .update({
            first_name: customerInfo.first_name,
            last_name: customerInfo.last_name,
            email: customerInfo.email,
            phone: customerInfo.phone,
            business_name: customerInfo.business_name || null,
          })
          .eq('id', order.customer_id);

        if (customerError) {
          console.error('Failed to update customer info:', customerError);
          showToast('Failed to save your information. Please try again.', 'error');
          setProcessing(false);
          return;
        }
      }

      if (tipCents > 0) {
        const { error: tipError } = await supabase
          .from('orders')
          .update({ tip_cents: tipCents })
          .eq('id', order.id);

        if (tipError) {
          console.error('Failed to save tip:', tipError);
          showToast('Failed to save tip amount. Please try again.', 'error');
          setProcessing(false);
          return;
        }
      }

      if (requireCardOnFile) {
        const { error: paymentAmountError } = await supabase
          .from('orders')
          .update({ customer_selected_payment_cents: actualPaymentCents })
          .eq('id', order.id);

        if (paymentAmountError) {
          console.error('Failed to save payment selection:', paymentAmountError);
          showToast('Failed to save payment selection. Please try again.', 'error');
          setProcessing(false);
          return;
        }

        const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
          'stripe-checkout',
          {
            body: {
              orderId: order.id,
              depositCents: actualPaymentCents,
              tipCents,
              customerEmail: customerInfo.email || order.customers?.email,
              customerName: `${customerInfo.first_name || order.customers?.first_name || ''} ${customerInfo.last_name || order.customers?.last_name || ''}`.trim(),
              invoiceMode: true,
            },
          }
        );

        if (sessionError || !sessionData?.url) {
          throw new Error(sessionError?.message || 'Failed to create checkout session');
        }

        await supabase
          .from('invoice_links' as any)
          .update({ customer_filled: true })
          .eq('id', invoiceLink?.id);

        window.location.href = sessionData.url;
        return;
      }

      const { error: statusError } = await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', order.id);

      if (statusError) {
        console.error('Failed to confirm order:', statusError);
        showToast('Failed to confirm order. Please try again.', 'error');
        setProcessing(false);
        return;
      }

      await supabase
        .from('invoice_links' as any)
        .update({ customer_filled: true })
        .eq('id', invoiceLink?.id);

      const email = customerInfo.email || order.customers?.email || '';
      const phone = customerInfo.phone || order.customers?.phone || '';
      const firstName = customerInfo.first_name || order.customers?.first_name || '';
      const portalUrl = `${window.location.origin}/customer-portal/${order.id}`;
      const smsMessage = `Hi ${firstName}, your Bounce Party Club booking (Order #${formatOrderId(order.id)}) has been confirmed! Event date: ${format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}. View your portal: ${portalUrl}`;

      let notificationsSent = false;

      if (email) {
        try {
          await sendNotificationToCustomer({
            email,
            phone,
            emailSubject: `Booking Confirmed - Order #${formatOrderId(order.id)}`,
            emailHtml: `<p>Hi ${firstName},</p><p>Your Bounce Party Club booking has been confirmed! Event date: ${format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}.</p><p><a href="${portalUrl}">View your portal</a></p>`,
            smsMessage,
            orderId: order.id,
          });
          notificationsSent = true;
        } catch (notifyErr) {
          console.error('Failed to send confirmation notifications:', notifyErr);
        }
      } else if (phone) {
        try {
          await sendNotificationToCustomer({
            email: '',
            phone,
            emailSubject: '',
            emailHtml: '',
            smsMessage,
            orderId: order.id,
          });
          notificationsSent = true;
        } catch (notifyErr) {
          console.error('Failed to send confirmation SMS:', notifyErr);
        }
      }

      if (notificationsSent) {
        const { error: flagError } = await supabase
          .from('orders')
          .update({ booking_confirmation_sent: true })
          .eq('id', order.id);

        if (flagError) {
          console.error('Failed to mark booking_confirmation_sent:', flagError);
        }
      }

      showToast('Order confirmed successfully!', 'success');
      onApprovalSuccess();
    } catch (error: any) {
      console.error('Error accepting invoice:', error);
      showToast(error.message || 'Failed to process. Please try again.', 'error');
      setProcessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 sm:px-8 py-6 text-white">
            <div className="flex items-center gap-4">
              <button
                onClick={() => window.location.href = '/'}
                className="hover:opacity-80 transition-opacity flex-shrink-0"
                title="Return to Home"
              >
                <img
                  src="/bounce%20party%20club%20logo.png"
                  alt="Bounce Party Club"
                  className="h-12 sm:h-16 w-12 sm:w-16 object-contain"
                />
              </button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold">Your Invoice</h1>
                <p className="mt-1 text-sm opacity-90">Order #{formatOrderId(order.id)}</p>
                <p className="text-xs opacity-90">
                  Event Date: {format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-8">
            {order.admin_message && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 mb-1">Message from Bounce Party Club</p>
                <p className="text-sm text-blue-900">{order.admin_message}</p>
              </div>
            )}

            <SimpleInvoiceDisplay
              eventDate={format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
              startWindow={order.start_window || ''}
              endWindow={order.end_window || ''}
              addressLine1={order.addresses?.line1 || ''}
              addressLine2={order.addresses?.line2 || undefined}
              city={order.addresses?.city || ''}
              state={order.addresses?.state || ''}
              zip={order.addresses?.zip || ''}
              locationType={order.location_type || ''}
              pickupPreference={order.pickup_preference || undefined}
              canUseStakes={order.surface !== 'concrete' && order.surface !== 'asphalt' ? true : false}
              generatorQty={order.generator_qty || 0}
              orderItems={orderItems}
              orderSummary={orderSummary}
              taxWaived={order.tax_waived || false}
              travelFeeWaived={order.travel_fee_waived || false}
              surfaceFeeWaived={order.surface_fee_waived || false}
              generatorFeeWaived={order.generator_fee_waived || false}
              sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
              showTip={false}
              showPricingNotice={false}
              onPrint={handlePrintInvoice}
            />

            {!hasCustomer && (
              <div className="mt-6">
                <CustomerInfoForm customerInfo={customerInfo} onChange={setCustomerInfo} />
              </div>
            )}

            {depositDueCents > 0 && requireCardOnFile && (
              <div className="mt-6">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Payment Amount</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <label
                    className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      paymentAmount === 'deposit'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="deposit"
                      checked={paymentAmount === 'deposit'}
                      onChange={() => setPaymentAmount('deposit')}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Minimum Deposit</span>
                    <span className="text-lg font-bold text-blue-600 mt-1">
                      {formatCurrency(depositDueCents)}
                    </span>
                    <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
                  </label>

                  <label
                    className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      paymentAmount === 'full'
                        ? 'border-green-600 bg-green-50'
                        : 'border-slate-300 hover:border-green-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="full"
                      checked={paymentAmount === 'full'}
                      onChange={() => setPaymentAmount('full')}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Full Payment</span>
                    <span className="text-lg font-bold text-green-600 mt-1">
                      {formatCurrency(totalCents)}
                    </span>
                    <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
                  </label>

                  <label
                    className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all sm:col-span-2 ${
                      paymentAmount === 'custom'
                        ? 'border-teal-600 bg-teal-50'
                        : 'border-slate-300 hover:border-teal-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="custom"
                      checked={paymentAmount === 'custom'}
                      onChange={() => setPaymentAmount('custom')}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Custom Amount</span>
                    {paymentAmount === 'custom' && (
                      <div className="mt-2 relative">
                        <span className="absolute left-3 top-2.5 text-slate-600">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min={(depositDueCents / 100).toFixed(2)}
                          max={(totalCents / 100).toFixed(2)}
                          value={customPaymentAmount}
                          onChange={(e) => setCustomPaymentAmount(e.target.value)}
                          placeholder={(depositDueCents / 100).toFixed(2)}
                          className="w-full pl-7 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                  </label>
                </div>

                <div className="mt-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Add a Tip (Optional)</h3>
                  <TipSelector
                    totalCents={totalCents}
                    tipAmount={tipAmount}
                    customTipAmount={customTipAmount}
                    onTipAmountChange={setTipAmount}
                    onCustomTipAmountChange={setCustomTipAmount}
                    formatCurrency={formatCurrency}
                  />
                </div>

                {actualPaymentCents > 0 && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-semibold text-green-900">
                      You will be charged {formatCurrency(actualPaymentCents)} today
                      {tipCents > 0 && ` (includes ${formatCurrency(tipCents)} crew tip)`}.
                    </p>
                    {actualPaymentBaseCents < totalCents && (
                      <p className="text-xs text-green-800 mt-1">
                        Remaining balance of {formatCurrency(totalCents - actualPaymentBaseCents)} is due at the event.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {requireCardOnFile && (
              <div className="mt-6">
                <CardOnFileAuthorization
                  cardOnFileConsent={cardOnFileConsent}
                  onCardOnFileConsentChange={setCardOnFileConsent}
                  smsConsent={smsConsent}
                  onSmsConsentChange={setSmsConsent}
                />
              </div>
            )}

            <div className="mt-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                />
                <span className="text-sm text-slate-700">
                  I have reviewed this invoice and agree to the pricing and event details shown above. *
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowInvoiceModal(true)}
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                <FileText className="w-5 h-5" />
                View as Invoice / Print PDF
              </button>

              <button
                onClick={handleAccept}
                disabled={processing || !accepted || (requireCardOnFile && !cardOnFileConsent)}
                className={`flex-1 flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-lg transition-colors ${
                  processing || !accepted || (requireCardOnFile && !cardOnFileConsent)
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                {processing
                  ? 'Processing...'
                  : requireCardOnFile
                  ? `Accept & Pay ${formatCurrency(actualPaymentCents)}`
                  : 'Accept & Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showInvoiceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-5xl w-full my-8">
            <div className="no-print flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Invoice Preview</h2>
              <div className="flex gap-3">
                <button
                  onClick={handlePrintInvoice}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print / Save PDF
                </button>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                  Close
                </button>
              </div>
            </div>
            <div className="p-4">
              <SimpleInvoiceDisplay
                eventDate={format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
                startWindow={order.start_window || ''}
                endWindow={order.end_window || ''}
                addressLine1={order.addresses?.line1 || ''}
                addressLine2={order.addresses?.line2 || undefined}
                city={order.addresses?.city || ''}
                state={order.addresses?.state || ''}
                zip={order.addresses?.zip || ''}
                locationType={order.location_type || ''}
                pickupPreference={order.pickup_preference || undefined}
                canUseStakes={order.surface !== 'concrete' && order.surface !== 'asphalt' ? true : false}
                generatorQty={order.generator_qty || 0}
                orderItems={orderItems}
                orderSummary={orderSummary}
                taxWaived={order.tax_waived || false}
                travelFeeWaived={order.travel_fee_waived || false}
                surfaceFeeWaived={order.surface_fee_waived || false}
                generatorFeeWaived={order.generator_fee_waived || false}
                sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
                showTip={false}
                showPricingNotice={true}
                onPrint={handlePrintInvoice}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
