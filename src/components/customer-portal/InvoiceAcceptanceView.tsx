import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import { Loader2, CreditCard, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { OrderSummaryDisplay } from '../../lib/orderSummary';
import { PrintableInvoice } from '../invoice/PrintableInvoice';
import { PrintModal } from '../common/PrintModal';
import { SimpleInvoiceDisplay } from '../shared/SimpleInvoiceDisplay';
import { RentalTerms } from '../waiver/RentalTerms';
import { TipSelector } from '../payment/TipSelector';
import { PaymentAmountSelector } from './PaymentAmountSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { CancelOrderModal } from './CancelOrderModal';
import { showToast } from '../../lib/notifications';

interface InvoiceAcceptanceViewProps {
  order: any;
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: any | null;
  orderSummary: OrderSummaryDisplay | null;
  onReload: () => void;
}

export function InvoiceAcceptanceView({
  order,
  orderItems,
  discounts,
  customFees,
  invoiceLink,
  orderSummary,
  onReload,
}: InvoiceAcceptanceViewProps) {
  const [customerInfo, setCustomerInfo] = useState({
    first_name: order.customers?.first_name || '',
    last_name: order.customers?.last_name || '',
    email: order.customers?.email || '',
    phone: order.customers?.phone || '',
    business_name: order.customers?.business_name || '',
  });
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [overnightResponsibilityAccepted, setOvernightResponsibilityAccepted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customPaymentAmount, setCustomPaymentAmount] = useState('');
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const needsCustomerInfo = invoiceLink && !invoiceLink.customer_filled;

  const prepareInvoiceData = () => {
    if (!order) return null;

    const quoteData = {
      event_date: order.event_date,
      start_window: order.start_window,
      address_line1: order.addresses?.line1 || '',
      address_line2: order.addresses?.line2 || '',
      city: order.addresses?.city || '',
      state: order.addresses?.state || '',
      zip: order.addresses?.zip || '',
      location_type: order.location_type,
      pickup_preference: order.pickup_preference,
      surface: order.surface,
      generator_qty: order.generator_qty || 0,
    };

    const totalCents =
      order.subtotal_cents +
      (order.generator_fee_cents || 0) +
      order.travel_fee_cents +
      order.surface_fee_cents +
      (order.same_day_pickup_fee_cents || 0) +
      order.tax_cents +
      (order.tip_cents || 0);

    const discountTotal = discounts.reduce((sum: number, d: any) => {
      if (d.amount_cents > 0) {
        return sum + d.amount_cents;
      } else if (d.percentage > 0) {
        const taxableBase =
          order.subtotal_cents +
          (order.generator_fee_cents || 0) +
          order.travel_fee_cents +
          order.surface_fee_cents;
        return sum + Math.round(taxableBase * (d.percentage / 100));
      }
      return sum;
    }, 0);

    const customFeesTotal = customFees.reduce((sum: number, f: any) => sum + f.amount_cents, 0);

    const priceBreakdown = {
      subtotal_cents: order.subtotal_cents,
      travel_fee_cents: order.travel_fee_cents,
      travel_fee_display_name: order.travel_total_miles
        ? `Travel Fee (${order.travel_total_miles.toFixed(1)} mi)`
        : 'Travel Fee',
      surface_fee_cents: order.surface_fee_cents,
      same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
      generator_fee_cents: order.generator_fee_cents || 0,
      discount_cents: discountTotal,
      custom_fees_cents: customFeesTotal,
      tax_cents: order.tax_cents,
      tip_cents: order.tip_cents || 0,
      total_cents: totalCents - discountTotal + customFeesTotal,
      deposit_due_cents: order.deposit_due_cents,
      balance_due_cents: order.balance_due_cents,
    };

    const cart = orderItems.map((item: any) => ({
      unit_id: item.unit_id,
      unit_name: item.units?.name || 'Unknown Unit',
      wet_or_dry: item.wet_or_dry,
      unit_price_cents: item.unit_price_cents * item.qty,
      qty: item.qty,
    }));

    const contactData = {
      first_name: order.customers?.first_name || customerInfo.first_name,
      last_name: order.customers?.last_name || customerInfo.last_name,
      email: order.customers?.email || customerInfo.email,
      phone: order.customers?.phone || customerInfo.phone,
      business_name: order.customers?.business_name || customerInfo.business_name,
    };

    return { quoteData, priceBreakdown, cart, contactData };
  };

  async function handleAcceptInvoice() {
    if (!cardOnFileConsent || !smsConsent) {
      showToast('Please accept both authorization and consent terms', 'error');
      return;
    }

    if (
      needsCustomerInfo &&
      (!customerInfo.first_name ||
        !customerInfo.last_name ||
        !customerInfo.email ||
        !customerInfo.phone)
    ) {
      showToast('Please fill in all required customer information', 'error');
      return;
    }

    if (order.pickup_preference === 'next_day' && !overnightResponsibilityAccepted) {
      showToast('Please accept the overnight responsibility agreement', 'error');
      return;
    }

    setProcessing(true);

    try {
      let customerId = order.customer_id;

      if (needsCustomerInfo && customerInfo.email) {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert([customerInfo])
          .select()
          .single();

        if (customerError) throw customerError;
        customerId = newCustomer.id;

        await supabase
          .from('orders')
          .update({
            customer_id: customerId,
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        await supabase
          .from('invoice_links')
          .update({ customer_filled: true })
          .eq('id', invoiceLink.id);
      } else {
        await supabase
          .from('orders')
          .update({
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      }

      let actualPaymentCents = 0;
      const totalCents = order.deposit_due_cents + order.balance_due_cents;

      if (paymentAmount === 'deposit') {
        actualPaymentCents = order.deposit_due_cents;
      } else if (paymentAmount === 'full') {
        actualPaymentCents = totalCents;
      } else if (paymentAmount === 'custom' && customPaymentAmount) {
        actualPaymentCents = Math.round(parseFloat(customPaymentAmount) * 100);
        if (actualPaymentCents < order.deposit_due_cents) {
          showToast(
            `Payment amount must be at least ${formatCurrency(order.deposit_due_cents)}`,
            'error'
          );
          setProcessing(false);
          return;
        }
      } else {
        showToast('Please select a payment amount', 'error');
        setProcessing(false);
        return;
      }

      let tipCents = 0;
      if (tipAmount === '10') {
        tipCents = Math.round(totalCents * 0.1);
      } else if (tipAmount === '15') {
        tipCents = Math.round(totalCents * 0.15);
      } else if (tipAmount === '20') {
        tipCents = Math.round(totalCents * 0.2);
      } else if (tipAmount === 'custom' && customTipAmount) {
        tipCents = Math.round(parseFloat(customTipAmount) * 100);
      }

      if (tipCents > 0) {
        await supabase.from('orders').update({ tip_cents: tipCents }).eq('id', order.id);
      }

      if (actualPaymentCents === 0) {
        await supabase
          .from('orders')
          .update({
            status: 'awaiting_customer_approval',
          })
          .eq('id', order.id);

        showToast('Invoice accepted! You will receive a confirmation shortly.', 'success');
        window.location.reload();
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: order.id,
            depositCents: actualPaymentCents,
            tipCents: tipCents,
            customerEmail: customerInfo.email || order.customers?.email,
            customerName: customerInfo.first_name
              ? `${customerInfo.first_name} ${customerInfo.last_name}`
              : `${order.customers?.first_name} ${order.customers?.last_name}`,
            origin: window.location.origin,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      window.location.href = data.url;
    } catch (err: any) {
      console.error('Error accepting invoice:', err);
      showToast('Failed to process invoice: ' + err.message, 'error');
      setProcessing(false);
    }
  }

  const calculateTotalPayment = () => {
    let paymentCents = 0;
    const totalCents = order.deposit_due_cents + order.balance_due_cents;

    if (paymentAmount === 'deposit') {
      paymentCents = order.deposit_due_cents;
    } else if (paymentAmount === 'full') {
      paymentCents = totalCents;
    } else if (paymentAmount === 'custom' && customPaymentAmount) {
      paymentCents = Math.round(parseFloat(customPaymentAmount) * 100);
    }

    let tipCents = 0;
    if (tipAmount === '10') {
      tipCents = Math.round(totalCents * 0.1);
    } else if (tipAmount === '15') {
      tipCents = Math.round(totalCents * 0.15);
    } else if (tipAmount === '20') {
      tipCents = Math.round(totalCents * 0.2);
    } else if (tipAmount === 'custom' && customTipAmount) {
      tipCents = Math.round(parseFloat(customTipAmount) * 100);
    }

    return paymentCents + tipCents;
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <SimpleInvoiceDisplay
          eventDate={order.event_date}
          startWindow={order.start_window}
          endWindow={order.end_window}
          addressLine1={order.addresses?.line1 || ''}
          addressLine2={order.addresses?.line2}
          city={order.addresses?.city || ''}
          state={order.addresses?.state || ''}
          zip={order.addresses?.zip || ''}
          locationType={order.location_type}
          pickupPreference={order.pickup_preference}
          surface={order.surface}
          generatorQty={order.generator_qty || 0}
          orderItems={orderItems}
          orderSummary={orderSummary}
          taxWaived={order.tax_waived || false}
          travelFeeWaived={order.travel_fee_waived || false}
          surfaceFeeWaived={order.surface_fee_waived || false}
          generatorFeeWaived={order.generator_fee_waived || false}
          sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
          showTip={orderSummary ? orderSummary.tip > 0 : false}
          onViewPrintableInvoice={() => setShowInvoiceModal(true)}
        />

        <div className="bg-white rounded-lg shadow-md p-8 mt-6">
          <PaymentAmountSelector
            depositCents={order.deposit_due_cents}
            balanceCents={order.balance_due_cents}
            paymentAmount={paymentAmount}
            customAmount={customPaymentAmount}
            onPaymentAmountChange={setPaymentAmount}
            onCustomAmountChange={setCustomPaymentAmount}
          />

          <TipSelector
            totalCents={order.deposit_due_cents + order.balance_due_cents}
            tipAmount={tipAmount}
            customTipAmount={customTipAmount}
            onTipAmountChange={setTipAmount}
            onCustomTipAmountChange={setCustomTipAmount}
            formatCurrency={formatCurrency}
          />

          {needsCustomerInfo && (
            <CustomerInfoForm customerInfo={customerInfo} onChange={setCustomerInfo} />
          )}

          <div className="mb-8">
            <RentalTerms />
          </div>

          <div className="mb-8 space-y-4">
            {order.pickup_preference === 'next_day' && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                  <AlertCircle className="w-5 h-5 mr-2 text-amber-600" />
                  Overnight Responsibility Agreement
                </h3>
                <p className="text-sm text-slate-700 mb-3">
                  For next-day pickup rentals, you are responsible for the equipment left on
                  your property overnight.
                </p>
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overnightResponsibilityAccepted}
                    onChange={(e) => setOvernightResponsibilityAccepted(e.target.checked)}
                    className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                    required
                  />
                  <span className="ml-3 text-sm text-slate-700">
                    ⚠️ I understand the inflatable will remain on my property overnight and I am
                    legally responsible for its safety and security until pickup the next
                    morning. *
                  </span>
                </label>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                <Shield className="w-5 h-5 mr-2 text-green-600" />
                Card-on-File Authorization
              </h3>
              <p className="text-sm text-slate-700 mb-3">
                I authorize Bounce Party Club LLC to securely store my payment method and charge
                it for incidentals including damage, excess cleaning, or late fees as itemized
                in a receipt. I understand that any charges will be accompanied by photographic
                evidence and a detailed explanation.
              </p>
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={cardOnFileConsent}
                  onChange={(e) => setCardOnFileConsent(e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                  required
                />
                <span className="ml-3 text-sm text-slate-700">
                  I have read and agree to the card-on-file authorization terms above. *
                </span>
              </label>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2">SMS Notifications Consent</h3>
              <p className="text-sm text-slate-700 mb-3">
                By providing my phone number and checking the box below, I consent to receive
                transactional SMS text messages from Bounce Party Club LLC at the phone number
                provided. These messages may include order confirmations, delivery updates, and
                service-related notifications about my booking. Message frequency varies. Message
                and data rates may apply. You can reply STOP to opt-out at any time.
              </p>
              <label className="flex items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                  required
                />
                <span className="ml-3 text-sm text-slate-700">
                  I consent to receive SMS notifications about my booking and agree to the terms
                  above. *
                </span>
              </label>
            </div>
          </div>

          <button
            onClick={handleAcceptInvoice}
            disabled={
              processing ||
              !cardOnFileConsent ||
              !smsConsent ||
              (order.pickup_preference === 'next_day' && !overnightResponsibilityAccepted) ||
              (paymentAmount === 'custom' && !customPaymentAmount)
            }
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : calculateTotalPayment() === 0 ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Accept Invoice
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5 mr-2" />
                Accept & Pay {formatCurrency(calculateTotalPayment())}
              </>
            )}
          </button>

          <p className="text-xs text-slate-500 text-center mt-4">
            {order.deposit_due_cents === 0
              ? 'By accepting, you acknowledge the order details above'
              : 'Your payment information is secured with industry-standard encryption'}
          </p>

          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            className="w-full mt-4 bg-red-50 hover:bg-red-100 text-red-600 font-semibold py-3 px-6 rounded-lg transition-colors border-2 border-red-200"
            disabled={processing}
          >
            Cancel This Order
          </button>
        </div>

        {showCancelModal && (
          <CancelOrderModal
            orderId={order.id}
            eventDate={order.event_date}
            onClose={() => setShowCancelModal(false)}
            onSuccess={() => {
              showToast('Your order has been cancelled', 'success');
              onReload();
            }}
          />
        )}
      </div>

      {showInvoiceModal && prepareInvoiceData() && (
        <PrintModal
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          title="Invoice Preview"
          maxWidth="5xl"
        >
          <PrintableInvoice
            quoteData={prepareInvoiceData()!.quoteData}
            priceBreakdown={prepareInvoiceData()!.priceBreakdown}
            cart={prepareInvoiceData()!.cart}
            contactData={prepareInvoiceData()!.contactData}
            invoiceNumber={order?.id?.slice(0, 8).toUpperCase()}
            isPaid={false}
          />
        </PrintModal>
      )}
    </div>
  );
}
