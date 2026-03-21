import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import {
  Loader2,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { OrderSummaryDisplay } from '../../lib/orderSummary';
import { SimpleInvoiceDisplay } from '../shared/SimpleInvoiceDisplay';
import { TipSelector } from '../payment/TipSelector';
import { PaymentAmountSelector } from './PaymentAmountSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { CancelOrderModal } from './CancelOrderModal';
import { showToast } from '../../lib/notifications';
import { checkMultipleUnitsAvailability } from '../../lib/availability';
import {
  sendNotificationToCustomer,
  sendAdminSms,
} from '../../lib/notificationService';
import {
  generateConfirmationReceiptEmail,
  generateConfirmationSmsMessage,
} from '../../lib/orderEmailTemplates';
import { formatOrderId } from '../../lib/utils';

interface InvoiceAcceptanceViewProps {
  order: any;
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: any | null;
  orderSummary: OrderSummaryDisplay | null;
  onReload: () => void;
  onApprovalSuccess?: () => void;
}

export function InvoiceAcceptanceView({
  order,
  orderItems,
  invoiceLink,
  orderSummary,
  onReload,
  onApprovalSuccess,
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
  const [overnightResponsibilityAccepted, setOvernightResponsibilityAccepted] =
    useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<
    'deposit' | 'full' | 'custom'
  >('deposit');
  const [customPaymentAmount, setCustomPaymentAmount] = useState('');
  const [tipAmount, setTipAmount] = useState<
    'none' | '10' | '15' | '20' | 'custom'
  >('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);

  const needsCustomerInfo = !order.customer_id || (invoiceLink && !invoiceLink.customer_filled);
  const totalCents = order.deposit_due_cents + order.balance_due_cents;

  function getActualPaymentCents(): number {
    if (paymentAmount === 'deposit') return order.deposit_due_cents;
    if (paymentAmount === 'full') return totalCents;

    if (paymentAmount === 'custom' && customPaymentAmount) {
      return Math.round(parseFloat(customPaymentAmount) * 100);
    }

    return 0;
  }

  function getTipCents(): number {
    if (tipAmount === '10') return Math.round(totalCents * 0.1);
    if (tipAmount === '15') return Math.round(totalCents * 0.15);
    if (tipAmount === '20') return Math.round(totalCents * 0.2);

    if (tipAmount === 'custom' && customTipAmount) {
      return Math.round(parseFloat(customTipAmount) * 100);
    }

    return 0;
  }

  const calculateTotalPayment = () => getActualPaymentCents() + getTipCents();

  const isNoCardRequired =
    order.require_card_on_file === false && order.deposit_due_cents === 0;

  async function handleAcceptInvoice() {
    if (!smsConsent) {
      showToast('Please accept the SMS consent terms', 'error');
      return;
    }

    if (!isNoCardRequired && !cardOnFileConsent) {
      showToast('Please accept the card-on-file authorization terms', 'error');
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

    if (
      order.pickup_preference === 'next_day' &&
      !overnightResponsibilityAccepted
    ) {
      showToast('Please accept the overnight responsibility agreement', 'error');
      return;
    }

    const actualPaymentCents = getActualPaymentCents();

    if (!isNoCardRequired && paymentAmount === 'custom' && customPaymentAmount) {
      if (actualPaymentCents < order.deposit_due_cents) {
        showToast(
          `Payment amount must be at least ${formatCurrency(order.deposit_due_cents)}`,
          'error'
        );
        return;
      }
    }

    if (
      !isNoCardRequired &&
      actualPaymentCents === 0 &&
      paymentAmount !== 'deposit'
    ) {
      showToast('Please select a payment amount', 'error');
      return;
    }

    setProcessing(true);

    try {
      let customerId = order.customer_id;

      if (needsCustomerInfo && customerInfo.email) {
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('email', customerInfo.email)
          .maybeSingle();

        if (existingCustomer) {
          customerId = existingCustomer.id;

          await supabase
            .from('customers')
            .update({
              first_name: customerInfo.first_name,
              last_name: customerInfo.last_name,
              phone: customerInfo.phone,
              ...(customerInfo.business_name ? { business_name: customerInfo.business_name } : {}),
            })
            .eq('id', existingCustomer.id);
        } else {
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert([customerInfo])
            .select()
            .single();

          if (customerError) throw customerError;

          customerId = newCustomer.id;
        }

        const { error: consentUpdateError } = await supabase
          .from('orders')
          .update({
            customer_id: customerId,
            card_on_file_consent: isNoCardRequired ? false : cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (consentUpdateError) {
          console.error('Failed to record consent:', consentUpdateError);
          showToast('Failed to save your information. Please try again.', 'error');
          setProcessing(false);
          return;
        }

        if (invoiceLink) {
          await supabase
            .from('invoice_links' as any)
            .update({ customer_filled: true })
            .eq('id', invoiceLink.id);
        }
      } else {
        const { error: consentUpdateError } = await supabase
          .from('orders')
          .update({
            card_on_file_consent: isNoCardRequired ? false : cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (consentUpdateError) {
          console.error('Failed to record consent:', consentUpdateError);
          showToast('Failed to save your information. Please try again.', 'error');
          setProcessing(false);
          return;
        }
      }

      const tipCents = getTipCents();

      // Check unit availability before proceeding
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('unit_id')
        .eq('order_id', order.id);

      if (orderItems && orderItems.length > 0) {
        const availabilityChecks = orderItems.map((item: any) => ({
          unitId: item.unit_id,
          eventStartDate: order.event_date,
          eventEndDate: order.event_end_date || order.event_date,
          excludeOrderId: order.id,
        }));

        const results = await checkMultipleUnitsAvailability(availabilityChecks);
        const unavailable = results.filter((r) => !r.isAvailable);

        if (unavailable.length > 0) {
          showToast(
            'Sorry, one or more items in your order are no longer available for your event date. Please contact us to reschedule.',
            'error'
          );
          setProcessing(false);
          return;
        }
      }

      if (tipCents > 0) {
        const { error: tipUpdateError } = await supabase
          .from('orders')
          .update({ tip_cents: tipCents })
          .eq('id', order.id);

        if (tipUpdateError) {
          console.error('Failed to record tip:', tipUpdateError);
          showToast('Failed to save tip amount. Please try again.', 'error');
          setProcessing(false);
          return;
        }
      }

      // No card required & $0 deposit: confirm order directly without Stripe
      if (isNoCardRequired) {
        const fieldToUpdate =
          order.pickup_preference === 'next_day'
            ? 'overnight_responsibility_accepted'
            : 'same_day_responsibility_accepted';

        const { error: confirmError } = await supabase
          .from('orders')
          .update({
            [fieldToUpdate]: true,
            status: 'confirmed',
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (confirmError) {
          console.error('Error confirming order:', confirmError);
          showToast(
            'Failed to confirm booking. Please try again or contact support.',
            'error'
          );
          setProcessing(false);
          return;
        }

        const firstName = order.customers?.first_name || customerInfo.first_name || '';
        const lastName = order.customers?.last_name || customerInfo.last_name || '';
        const email = order.customers?.email || customerInfo.email || '';
        const phone = order.customers?.phone || customerInfo.phone || '';

        const customer = {
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        };

        const smsMessage = generateConfirmationSmsMessage(order, firstName);

        const totalCents =
          orderSummary
            ? orderSummary.total + tipCents
            : (order.subtotal_cents || 0) +
              (order.travel_fee_cents || 0) +
              (order.surface_fee_cents || 0) +
              (order.same_day_pickup_fee_cents || 0) +
              (order.generator_fee_cents || 0) +
              (order.tax_cents || 0) +
              tipCents;

        const { data: fullItems } = await supabase
          .from('order_items')
          .select('*, units(*)')
          .eq('order_id', order.id);

        let notificationsSent = false;

        if (email) {
          try {
            const confirmationEmail = generateConfirmationReceiptEmail({
              order,
              customer,
              address: order.addresses,
              items: fullItems || [],
              totalCents,
            });

            await sendNotificationToCustomer({
              email,
              phone,
              emailSubject: `Booking Confirmed - Receipt for Order #${formatOrderId(order.id)}`,
              emailHtml: confirmationEmail,
              smsMessage,
              orderId: order.id,
            });

            notificationsSent = true;
          } catch (notifError) {
            console.error('Error sending confirmation notifications:', notifError);
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
          } catch (notifError) {
            console.error('Error sending SMS confirmation:', notifError);
          }
        }

        if (notificationsSent) {
          await supabase
            .from('orders')
            .update({ booking_confirmation_sent: true })
            .eq('id', order.id);
        }

        try {
          await sendAdminSms(
            `Invoice accepted (no payment): Order #${formatOrderId(order.id)} - ${firstName} ${lastName}, ${order.event_date}. Full balance $${((order.balance_due_cents || 0) / 100).toFixed(2)} due day of event.`,
            order.id
          );
        } catch (adminNotifError) {
          console.error('Error sending admin notification:', adminNotifError);
        }

        if (onApprovalSuccess) {
          onApprovalSuccess();
        } else {
          onReload();
        }

        return;
      }

      // Store the chosen payment amount so charge-deposit uses it
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

      const effectiveEmail = customerInfo.email || order.customers?.email;
      const effectiveName = customerInfo.first_name
        ? `${customerInfo.first_name} ${customerInfo.last_name}`
        : `${order.customers?.first_name} ${order.customers?.last_name}`;

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
            setupMode: true,
            invoiceMode: true,
            customerEmail: effectiveEmail,
            customerName: effectiveName,
            origin: window.location.origin,
            paymentState: {
              paymentAmount,
              customPaymentAmount,
              newTipCents: tipCents,
            },
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

  const handlePrintInvoice = () => {
    const invoiceData = {
      orderData: {
        event_date: order.event_date,
        start_window: order.start_window,
        end_window: order.end_window,
        address_line1: order.addresses?.line1 || '',
        address_line2: order.addresses?.line2 || '',
        city: order.addresses?.city || '',
        state: order.addresses?.state || '',
        zip: order.addresses?.zip || '',
        location_type: order.location_type,
        pickup_preference: order.pickup_preference,
        can_use_stakes: order.can_use_stakes,
        generator_qty: order.generator_qty || 0,
        tax_waived: order.tax_waived || false,
        travel_fee_waived: order.travel_fee_waived || false,
        surface_fee_waived: order.surface_fee_waived || false,
        generator_fee_waived: order.generator_fee_waived || false,
        same_day_pickup_fee_waived: order.same_day_pickup_fee_waived || false,
      },
      orderItems,
      orderSummary,
      contactData: {
        first_name: customerInfo.first_name || order.customers?.first_name || '',
        last_name: customerInfo.last_name || order.customers?.last_name || '',
        email: customerInfo.email || order.customers?.email || '',
        phone: customerInfo.phone || order.customers?.phone || '',
        business_name:
          customerInfo.business_name || order.customers?.business_name || '',
      },
    };

    sessionStorage.setItem('invoice-preview-data', JSON.stringify(invoiceData));
    sessionStorage.setItem(
      'invoice-preview-return-to',
      `/customer-portal/${order.id}`
    );

    window.open('/invoice-preview', '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto" id="print-content-wrapper">
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
          canUseStakes={order.can_use_stakes}
          generatorQty={order.generator_qty || 0}
          orderItems={orderItems}
          orderSummary={orderSummary}
          taxWaived={order.tax_waived || false}
          travelFeeWaived={order.travel_fee_waived || false}
          surfaceFeeWaived={order.surface_fee_waived || false}
          generatorFeeWaived={order.generator_fee_waived || false}
          sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
          showTip={orderSummary ? orderSummary.tip > 0 : false}
          showPricingNotice={false}
          onPrint={handlePrintInvoice}
        />

        <div className="bg-white rounded-lg shadow-md p-8 mt-6 no-print">
          {isNoCardRequired ? (
            <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="font-semibold text-green-800">
                No payment required today
              </p>
              <p className="text-sm text-green-700 mt-1">
                The full balance of {formatCurrency(order.balance_due_cents)} is
                due on the day of your event.
              </p>
            </div>
          ) : (
            <>
              <PaymentAmountSelector
                depositCents={order.deposit_due_cents}
                balanceCents={order.balance_due_cents}
                paymentAmount={paymentAmount}
                customAmount={customPaymentAmount}
                onPaymentAmountChange={setPaymentAmount}
                onCustomAmountChange={setCustomPaymentAmount}
              />

              <TipSelector
                totalCents={totalCents}
                tipAmount={tipAmount}
                customTipAmount={customTipAmount}
                onTipAmountChange={setTipAmount}
                onCustomTipAmountChange={setCustomTipAmount}
                formatCurrency={formatCurrency}
              />
            </>
          )}

          {needsCustomerInfo && (
            <CustomerInfoForm
              customerInfo={customerInfo}
              onChange={setCustomerInfo}
            />
          )}

          <div className="mb-8 space-y-4">
            {order.pickup_preference === 'next_day' && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                  <AlertCircle className="w-5 h-5 mr-2 text-amber-600" />
                  Overnight Responsibility Agreement
                </h3>

                <p className="text-sm text-slate-700 mb-3">
                  For next-day pickup rentals, you are responsible for the
                  equipment left on your property overnight.
                </p>

                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overnightResponsibilityAccepted}
                    onChange={(e) =>
                      setOvernightResponsibilityAccepted(e.target.checked)
                    }
                    className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                    required
                  />
                  <span className="ml-3 text-sm text-slate-700">
                    I understand the inflatable will remain on my property
                    overnight and I am legally responsible for its safety and
                    security until pickup the next morning. *
                  </span>
                </label>
              </div>
            )}

            {!isNoCardRequired && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                  <Shield className="w-5 h-5 mr-2 text-green-600" />
                  Card-on-File Authorization
                </h3>

                <p className="text-sm text-slate-700 mb-3">
                  I authorize Bounce Party Club LLC to securely store my payment
                  method and charge it for incidentals including damage, excess
                  cleaning, or late fees as itemized in a receipt. I understand
                  that any charges will be accompanied by photographic evidence
                  and a detailed explanation.
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
                    I have read and agree to the card-on-file authorization
                    terms above. *
                  </span>
                </label>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-2">
                SMS Notifications Consent
              </h3>

              <p className="text-sm text-slate-700 mb-3">
                By providing my phone number and checking the box below, I
                consent to receive transactional SMS text messages from Bounce
                Party Club LLC at the phone number provided. These messages may
                include order confirmations, delivery updates, and
                service-related notifications about my booking. Message
                frequency varies. Message and data rates may apply. You can
                reply STOP to opt-out at any time.
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
                  I consent to receive SMS notifications about my booking and
                  agree to the terms above. *
                </span>
              </label>
            </div>
          </div>

          <button
            onClick={handleAcceptInvoice}
            disabled={
              processing ||
              (!isNoCardRequired && !cardOnFileConsent) ||
              !smsConsent ||
              (order.pickup_preference === 'next_day' &&
                !overnightResponsibilityAccepted) ||
              (!isNoCardRequired &&
                paymentAmount === 'custom' &&
                !customPaymentAmount) ||
              (needsCustomerInfo &&
                (!customerInfo.first_name ||
                  !customerInfo.last_name ||
                  !customerInfo.email ||
                  !customerInfo.phone))
            }
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
          >
            {processing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : isNoCardRequired ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Accept & Confirm Booking
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
            {isNoCardRequired
              ? 'By accepting, you confirm your booking. Full balance is due on event day.'
              : order.deposit_due_cents === 0
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
    </div>
  );
}