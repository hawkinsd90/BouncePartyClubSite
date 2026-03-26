import { useState, useEffect } from 'react';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { TipSelector, calculateTipCents } from '../payment/TipSelector';
import { showToast } from '../../lib/notifications';

interface PaymentTabProps {
  orderId: string;
  order: any;
  balanceDue: number;
  orderSummary: any;
  onPaymentComplete: () => void;
  restoredTipCents?: number;
}

interface ConfirmModalProps {
  balanceDue: number;
  tipCents: number;
  totalDueNow: number;
  cardBrand: string | null;
  cardLast4: string | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUpdateCard: () => void;
}

function ConfirmChargeModal({
  balanceDue,
  tipCents,
  totalDueNow,
  cardBrand,
  cardLast4,
  loading,
  onConfirm,
  onCancel,
  onUpdateCard,
}: ConfirmModalProps) {
  const brandName = cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : null;
  const cardText = brandName && cardLast4
    ? `${brandName} \u2022\u2022\u2022\u2022 ${cardLast4}`
    : cardLast4
    ? `Card \u2022\u2022\u2022\u2022 ${cardLast4}`
    : brandName
    ? `${brandName} card on file`
    : 'Card on file';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-5">
          <h3 className="text-lg font-bold text-slate-900 mb-1">Confirm Payment</h3>
          <p className="text-sm text-slate-600 mb-4">
            Review your payment details before we charge your card.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-2">
            {balanceDue > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Remaining Balance:</span>
                <span className="font-medium">{formatCurrency(balanceDue)}</span>
              </div>
            )}
            {tipCents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Crew Tip:</span>
                <span className="font-medium text-green-700">+{formatCurrency(tipCents)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="font-semibold text-slate-900">Total Charge:</span>
              <span className="font-bold text-lg text-blue-600">{formatCurrency(totalDueNow)}</span>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm font-medium text-blue-900">{cardText}</span>
            </div>
            <button
              onClick={onUpdateCard}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors ml-3 whitespace-nowrap"
            >
              Update Card
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                `Charge ${formatCurrency(totalDueNow)}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PaymentTab({ orderId, order, balanceDue, orderSummary, onPaymentComplete, restoredTipCents }: PaymentTabProps) {
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Restore tip state from card-update redirect
  useEffect(() => {
    if (restoredTipCents && restoredTipCents > 0) {
      setTipAmount('custom');
      setCustomTipAmount((restoredTipCents / 100).toFixed(2));
    }
  }, [restoredTipCents]);

  // Use canonical orderSummary.total when available (includes custom fees and discounts).
  // The fallback raw-field sum omits custom fees and discounts — only used if orderSummary
  // prop is not passed, which should not happen in normal portal rendering.
  const orderTotal: number = orderSummary
    ? orderSummary.total
    : (order.subtotal_cents || 0) +
      (order.travel_fee_waived ? 0 : (order.travel_fee_cents || 0)) +
      (order.surface_fee_waived ? 0 : (order.surface_fee_cents || 0)) +
      (order.same_day_pickup_fee_waived ? 0 : (order.same_day_pickup_fee_cents || 0)) +
      (order.generator_fee_waived ? 0 : (order.generator_fee_cents || 0)) +
      (order.tax_waived ? 0 : (order.tax_cents || 0));

  const tipCents = calculateTipCents(tipAmount, customTipAmount, orderTotal);
  const totalDueNow = balanceDue + tipCents;

  // Prefer order-level fields; fall back to the most recent succeeded payment row.
  const recentPayment = Array.isArray(order.payments)
    ? [...order.payments]
        .filter((p: any) => p.status === 'succeeded' && p.payment_last4)
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : null;
  const cardLast4: string | null = order.payment_method_last_four || recentPayment?.payment_last4 || null;
  const cardBrand: string | null = order.payment_method_brand || recentPayment?.payment_brand || null;
  const canChargeSavedCard = !!(order.stripe_customer_id && order.stripe_payment_method_id);
  const isDisabled = totalDueNow <= 0 || loading;

  // The already-paid amount is deposit + balance_paid (both stored without tip)
  const alreadyPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);

  async function executePayment() {
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const apiUrl = `${supabaseUrl}/functions/v1/customer-balance-payment`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({
          orderId,
          amountCents: balanceDue,
          tipCents,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process payment');
      }

      if (data.success) {
        showToast('Payment processed successfully!', 'success');
        setShowConfirmModal(false);
        onPaymentComplete();
      } else if (data.url) {
        // Checkout redirect — tip state is preserved in the URL via metadata
        window.location.href = data.url;
      } else {
        throw new Error('Unexpected response from payment processor');
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      showToast(error.message || 'Failed to process payment', 'error');
      setShowConfirmModal(false);
    } finally {
      setLoading(false);
    }
  }

  function handlePayClick() {
    if (isDisabled) return;
    if (canChargeSavedCard) {
      setShowConfirmModal(true);
    } else {
      executePayment();
    }
  }

  async function handleUpdateCard() {
    // Send customer through card-update (setup mode) Stripe Checkout,
    // preserving tip state via paymentState so stripe-checkout encodes it
    // in the ?card_updated return URL, which RegularPortalView then reads.
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({
          orderId,
          setupMode: true,
          paymentState: {
            newTipCents: tipCents,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to start card update');
      }

      window.location.href = data.url;
    } catch (error: any) {
      console.error('Card update error:', error);
      showToast('Failed to start card update. Please try again.', 'error');
    }
  }

  return (
    <>
      <div className="space-y-6">
        {balanceDue <= 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-green-900">Payment Complete</h3>
            <p className="text-sm text-green-700 mt-2">
              No balance due. You may still add a tip for the crew below.
            </p>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Total Order:</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(orderTotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Already Paid:</span>
                <span className="font-semibold text-green-700">
                  {formatCurrency(alreadyPaid)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-300">
                <span className="font-semibold text-slate-900">Balance Due:</span>
                <span className="text-xl font-bold text-blue-600">
                  {formatCurrency(balanceDue)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-base font-semibold text-slate-900 mb-3">Add a Tip for the Crew</h3>
          <TipSelector
            totalCents={orderTotal}
            tipAmount={tipAmount}
            customTipAmount={customTipAmount}
            onTipAmountChange={setTipAmount}
            onCustomTipAmountChange={setCustomTipAmount}
            formatCurrency={formatCurrency}
          />
        </div>

        {tipCents > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            {balanceDue > 0 && (
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">Balance:</span>
                <span className="font-medium">{formatCurrency(balanceDue)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-600">Tip:</span>
              <span className="font-medium text-green-700">+{formatCurrency(tipCents)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="font-semibold text-slate-900">Total Due Now:</span>
              <span className="font-bold text-lg text-blue-600">{formatCurrency(totalDueNow)}</span>
            </div>
          </div>
        )}

        {canChargeSavedCard && !isDisabled && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <CreditCard className="w-4 h-4 flex-shrink-0" />
              <span>
                {cardBrand && cardLast4
                  ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} \u2022\u2022\u2022\u2022 ${cardLast4} will be charged`
                  : cardLast4
                  ? `Card \u2022\u2022\u2022\u2022 ${cardLast4} will be charged`
                  : cardBrand
                  ? `${cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1)} card on file will be charged`
                  : 'Card on file will be charged'}
              </span>
            </div>
            <button
              onClick={handleUpdateCard}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 ml-3 whitespace-nowrap"
            >
              Update Card
            </button>
          </div>
        )}

        <button
          onClick={handlePayClick}
          disabled={isDisabled}
          className={`w-full font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 ${
            isDisabled
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              {balanceDue > 0
                ? tipCents > 0
                  ? `Pay ${formatCurrency(totalDueNow)}`
                  : 'Pay Balance Now'
                : tipCents > 0
                ? `Add Tip of ${formatCurrency(tipCents)}`
                : 'Pay Balance Now'}
            </>
          )}
        </button>

        <p className="text-xs text-slate-500 text-center">
          Secure payment powered by Stripe. We accept all major credit cards.
        </p>
      </div>

      {showConfirmModal && canChargeSavedCard && (
        <ConfirmChargeModal
          balanceDue={balanceDue}
          tipCents={tipCents}
          totalDueNow={totalDueNow}
          cardBrand={cardBrand}
          cardLast4={cardLast4}
          loading={loading}
          onConfirm={executePayment}
          onCancel={() => setShowConfirmModal(false)}
          onUpdateCard={() => {
            setShowConfirmModal(false);
            handleUpdateCard();
          }}
        />
      )}
    </>
  );
}
