import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import {
  Loader2,
  CreditCard,
  CheckCircle,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { OrderSummaryDisplay } from '../../lib/orderSummaryLoader';
import { SimpleInvoiceDisplay } from '../shared/SimpleInvoiceDisplay';
import { TipSelector } from '../payment/TipSelector';
import { PaymentAmountSelector } from './PaymentAmountSelector';
import { CustomerInfoForm } from './CustomerInfoForm';
import { CancelOrderModal } from './CancelOrderModal';
import { showToast } from '../../lib/toasts';
import { portalAction } from '../../lib/customerPortalApi';
import { checkEventEssentialsAvailability } from '../../lib/queries/products';
import { enterConfirmed } from '../../lib/orderLifecycleApi';
import {
  generateConfirmationReceiptEmail,
  generateConfirmationSmsMessage,
} from '../../lib/orderEmailTemplates';
import { formatOrderId } from '../../lib/utils';
import { createShortPortalLink } from '../../lib/portalShortLink';
import { portalPathForCurrentVisitor } from '../../lib/portalToken';
import { ReferralSourceSelect } from '../shared/ReferralSourceSelect';
import { getPublicBusinessSettings } from '../../lib/adminSettingsCache';

interface InvoiceAcceptanceViewProps {
  order: any;
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: any | null;
  // The portal/invoice token this visit arrived with (null for a signed-in owner).
  invoiceToken?: string | null;
  orderSummary: OrderSummaryDisplay | null;
  onReload: () => void;
  onApprovalSuccess?: () => void;
}

export function InvoiceAcceptanceView({
  order,
  orderItems,
  invoiceLink,
  invoiceToken,
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
  const [referralSource, setReferralSource] = useState<string>(order.referral_source || '');
  const [referralSourceDetail, setReferralSourceDetail] = useState<string>(order.referral_source_detail || '');
  const [referralError, setReferralError] = useState('');
  const [howDidYouHearEnabled, setHowDidYouHearEnabled] = useState(true);

  useEffect(() => {
    getPublicBusinessSettings().then(s => setHowDidYouHearEnabled(s.how_did_you_hear_enabled)).catch(() => {});
  }, []);

  const referralAlreadyCaptured = !!order.referral_source;

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

  const isCardSetupOnly =
    !isNoCardRequired &&
    order.deposit_due_cents === 0 &&
    order.require_card_on_file !== false;

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

    if (howDidYouHearEnabled && !referralAlreadyCaptured && !referralSource) {
      setReferralError('Please tell us how you heard about us.');
      showToast('Please tell us how you heard about us.', 'error');
      return;
    }
    setReferralError('');

    const actualPaymentCents = getActualPaymentCents();

    if (!isNoCardRequired && !isCardSetupOnly && paymentAmount === 'custom' && customPaymentAmount) {
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
      !isCardSetupOnly &&
      actualPaymentCents === 0 &&
      paymentAmount !== 'deposit'
    ) {
      showToast('Please select a payment amount', 'error');
      return;
    }

    setProcessing(true);

    try {
      // Verify item availability BEFORE writing any acceptance state.
      const allOrderItems: any[] = orderItems ?? [];

      if (allOrderItems.length === 0) {
        showToast('Sorry, we could not verify item availability. Please try again or contact us.', 'error');
        setProcessing(false);
        return;
      }

      // Check inflatable availability
      {
        const inflatableItems = allOrderItems.filter((item: any) => item.unit_id);
        if (inflatableItems.length > 0) {
          let unitsAvailable = false;
          try {
            const result = await portalAction<{ available: boolean }>(order.id, invoiceToken, 'check_unit_availability');
            unitsAvailable = result.available === true;
          } catch {
            unitsAvailable = false;
          }

          if (!unitsAvailable) {
            showToast(
              'Sorry, one or more items in your order are no longer available for your event date. Please contact us to reschedule.',
              'error'
            );
            setProcessing(false);
            return;
          }
        }

        // Check Event Essentials availability
        const eeItems = allOrderItems.filter((item: any) => !item.unit_id && (item.product_id || item.bundle_id));
        if (eeItems.length > 0) {
          const eeCheck = await checkEventEssentialsAvailability({
            items: eeItems,
            eventDate: order.event_date,
            eventEndDate: order.event_end_date || order.event_date,
            excludeOrderId: order.id,
          });
          if (!eeCheck.ok) {
            showToast(
              eeCheck.kind === 'unavailable'
                ? 'Sorry, one or more Event Essentials in your order are no longer available for your event date. Please contact us to reschedule.'
                : 'Sorry, we could not verify item availability. Please contact us to reschedule.',
              'error'
            );
            setProcessing(false);
            return;
          }
        }
      }

      const tipCents = getTipCents();

      try {
        await portalAction(order.id, invoiceToken, 'invoice_accept_details', {
          ...(needsCustomerInfo && customerInfo.email
            ? {
                customer: {
                  first_name: customerInfo.first_name,
                  last_name: customerInfo.last_name,
                  email: customerInfo.email,
                  phone: customerInfo.phone,
                  ...(customerInfo.business_name ? { business_name: customerInfo.business_name } : {}),
                },
              }
            : {}),
          cardOnFileConsent: isNoCardRequired ? false : cardOnFileConsent,
          smsConsent,
          ...(!referralAlreadyCaptured && referralSource
            ? { referralSource, ...(referralSourceDetail ? { referralSourceDetail } : {}) }
            : {}),
          ...(tipCents > 0 ? { tipCents } : {}),
        });
      } catch (saveError) {
        console.error('Failed to record acceptance:', saveError instanceof Error ? saveError.message : 'unknown');
        showToast('Failed to save your information. Please try again.', 'error');
        setProcessing(false);
        return;
      }

      // No card required & $0 deposit: confirm order directly without Stripe
      if (isNoCardRequired) {
        try {
          // Records the acceptance and the responsibility agreement; the order stays a draft until the lifecycle
          // function confirms it below.
          await portalAction(order.id, invoiceToken, 'invoice_confirm_no_card');
          const confirmation = await enterConfirmed(order.id, 'invoice_acceptance_no_card', 'waived', order.status, { invoiceToken: invoiceToken ?? null });
          if (!confirmation.success) throw new Error('lifecycle refused the confirmation');
        } catch (confirmError) {
          console.error('Error confirming order:', confirmError instanceof Error ? confirmError.message : 'unknown');
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

        try {
          const linkResult = await createShortPortalLink(order.id, supabase, order.event_date, invoiceToken ?? null);
          if (!linkResult.success) {
            throw new Error(`Failed to create short link: ${linkResult.error}`);
          }
          const portalUrl = linkResult.url;
          const smsMessage = generateConfirmationSmsMessage(order, firstName, portalUrl);
          const emailHtml = generateConfirmationReceiptEmail({
            order,
            customer,
            address: order.addresses,
            items: orderItems,
            payment: null,
            totalCents: order.balance_due_cents,
            portalUrl,
          });

          // Sent by the server to the customer on this order; the browser supplies only the wording (and whether the
          // customer agreed to texts), never a recipient.
          const confirmation: Record<string, string> = {};
          if (email) {
            confirmation.emailSubject = `Booking Confirmed - Receipt for Order #${formatOrderId(order.id)}`;
            confirmation.emailHtml = emailHtml;
          }
          if (smsConsent && phone) confirmation.smsMessage = smsMessage;
          if (Object.keys(confirmation).length > 0) {
            await portalAction(order.id, invoiceToken, 'send_confirmation', confirmation);
          }
        } catch (notifError: any) {
          console.error('[InvoiceAcceptanceView] confirmation notification failed (non-fatal):', notifError);
        }

        if (onApprovalSuccess) {
          onApprovalSuccess();
        } else {
          onReload();
        }

        return;
      }

      // Card-setup-only path: $0 deposit but card is still required.
      // Go to Stripe in setup mode — no charge today.
      if (isCardSetupOnly) {
        const effectiveEmailSetup = customerInfo.email || order.customers?.email;
        const effectiveNameSetup = customerInfo.first_name
          ? `${customerInfo.first_name} ${customerInfo.last_name}`
          : `${order.customers?.first_name} ${order.customers?.last_name}`;

        const setupResponse = await fetch(
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
              invoiceLinkToken: invoiceToken ?? null,
              customerEmail: effectiveEmailSetup,
              customerName: effectiveNameSetup,
              origin: window.location.origin,
              paymentState: {
                paymentAmount: 'deposit',
                customPaymentAmount: '',
                newTipCents: tipCents,
              },
            }),
          }
        );

        const setupData = await setupResponse.json();

        if (!setupResponse.ok || !setupData.url) {
          throw new Error(setupData.error || 'Failed to create checkout session');
        }

        window.location.href = setupData.url;
        return;
      }

      const effectiveEmail = customerInfo.email || order.customers?.email;
      const effectiveName = customerInfo.first_name
        ? `${customerInfo.first_name} ${customerInfo.last_name}`
        : `${order.customers?.first_name} ${order.customers?.last_name}`;

      // Persist the customer's chosen payment amount before redirecting so that
      // charge-deposit (called via the invoice_card_saved return path) reads the
      // correct value from order.customer_selected_payment_cents rather than
      // falling back to the raw deposit_due_cents.
      const resolvedPaymentType =
        paymentAmount === 'full' ? 'full' : paymentAmount === 'custom' ? 'custom' : 'deposit';

      try {
        await portalAction(order.id, invoiceToken, 'invoice_select_payment', {
          amountCents: actualPaymentCents,
          type: resolvedPaymentType,
        });
      } catch (selectionError) {
        console.error('Failed to save payment selection:', selectionError instanceof Error ? selectionError.message : 'unknown');
        showToast('Failed to save payment selection. Please try again.', 'error');
        setProcessing(false);
        return;
      }

      // Use setup mode so Stripe saves the card, then the invoice_card_saved
      // return path in CustomerPortal calls charge-deposit atomically — identical
      // to the working order-approval flow.
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
            invoiceLinkToken: invoiceToken ?? null,
            customerEmail: effectiveEmail,
            customerName: effectiveName,
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
      portalPathForCurrentVisitor(order.id)
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
          contactData={{
            first_name: customerInfo.first_name || order.customers?.first_name || '',
            last_name: customerInfo.last_name || order.customers?.last_name || '',
            email: customerInfo.email || order.customers?.email || '',
            phone: customerInfo.phone || order.customers?.phone || '',
            business_name: customerInfo.business_name || order.customers?.business_name || '',
          }}
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
          ) : isCardSetupOnly ? (
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
              <Shield className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="font-semibold text-blue-800">
                No payment due today
              </p>
              <p className="text-sm text-blue-700 mt-1">
                A card will be saved securely on file. The full balance of{' '}
                {formatCurrency(order.balance_due_cents)} is due on the day of your event.
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

              {howDidYouHearEnabled && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-3">One Quick Question</h3>
              {referralAlreadyCaptured ? (
                <ReferralSourceSelect
                  value={referralSource}
                  detail={referralSourceDetail}
                  onChange={() => {}}
                  readOnly
                />
              ) : (
                <ReferralSourceSelect
                  value={referralSource}
                  detail={referralSourceDetail}
                  onChange={(src, det) => {
                    setReferralSource(src);
                    setReferralSourceDetail(det);
                    if (src) setReferralError('');
                  }}
                  error={referralError}
                />
              )}
            </div>
              )}
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
                !isCardSetupOnly &&
                paymentAmount === 'custom' &&
                !customPaymentAmount) ||
              (needsCustomerInfo &&
                (!customerInfo.first_name ||
                  !customerInfo.last_name ||
                  !customerInfo.email ||
                  !customerInfo.phone)) ||
              (howDidYouHearEnabled && !referralAlreadyCaptured && !referralSource)
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
            ) : isCardSetupOnly ? (
              <>
                <CreditCard className="w-5 h-5 mr-2" />
                Accept & Save Card on File
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
              : isCardSetupOnly
                ? 'By accepting, your card will be saved on file. No charge is made today.'
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
            customerEmail={order.customer_email || order.customers?.email || ''}
            invoiceLinkToken={invoiceToken ?? null}
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