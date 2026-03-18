import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CheckCircle, XCircle, MapPin, Calendar, Package } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { TipSelector, calculateTipCents } from '../payment/TipSelector';
import { ApprovalModal } from './ApprovalModal';
import { RejectionModal } from './RejectionModal';

interface OrderApprovalViewProps {
  order: any;
  changelog: any[];
  orderSummary: any;
  onApprovalSuccess: () => void;
  onRejectionSuccess: () => void;
}

export function OrderApprovalView({
  order,
  changelog,
  orderSummary,
  onApprovalSuccess,
  onRejectionSuccess,
}: OrderApprovalViewProps) {
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customPaymentAmount, setCustomPaymentAmount] = useState('');
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [keepOriginalPayment, setKeepOriginalPayment] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);

  const currentTotalCents =
    (order.subtotal_cents || 0) +
    (order.generator_fee_cents || 0) +
    (order.travel_fee_cents || 0) +
    (order.surface_fee_cents || 0) +
    (order.same_day_pickup_fee_cents || 0) +
    (order.tax_cents || 0) -
    (order.discount_cents || 0);

  const currentDepositCents = order.deposit_due_cents || 0;

  useEffect(() => {
    const meetsMinimum = (order.customer_selected_payment_cents || 0) >= currentDepositCents;
    setKeepOriginalPayment(meetsMinimum);
    setPaymentAmount('deposit');

    const originalTipCents = order.tip_cents || 0;
    if (originalTipCents > 0) {
      const tenPct = Math.round(currentTotalCents * 0.1);
      const fifteenPct = Math.round(currentTotalCents * 0.15);
      const twentyPct = Math.round(currentTotalCents * 0.2);
      if (originalTipCents === tenPct) {
        setTipAmount('10');
        setCustomTipAmount('');
      } else if (originalTipCents === fifteenPct) {
        setTipAmount('15');
        setCustomTipAmount('');
      } else if (originalTipCents === twentyPct) {
        setTipAmount('20');
        setCustomTipAmount('');
      } else {
        setTipAmount('custom');
        setCustomTipAmount((originalTipCents / 100).toFixed(2));
      }
    } else {
      setTipAmount('none');
      setCustomTipAmount('');
    }
  }, [order.id]);

  const newTipCents = calculateTipCents(tipAmount, customTipAmount, currentTotalCents);

  const selectedPaymentBaseCents = (() => {
    if (keepOriginalPayment) return order.customer_selected_payment_cents || currentDepositCents;
    if (paymentAmount === 'deposit') return currentDepositCents;
    if (paymentAmount === 'full') return currentTotalCents;
    if (paymentAmount === 'custom' && customPaymentAmount) {
      return Math.round(parseFloat(customPaymentAmount) * 100);
    }
    return currentDepositCents;
  })();

  const selectedPaymentCents = selectedPaymentBaseCents + newTipCents;

  const recentChanges = changelog
    .filter(c => c.change_type === 'edit' || c.change_type === 'add' || c.change_type === 'remove')
    .slice(0, 10);

  const alreadyPaidDeposit =
    order.stripe_payment_status === 'paid' ||
    (order.deposit_paid_cents || 0) > 0;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-6 text-white">
            <div className="flex items-center gap-4">
              <img
                src="/bounce%20party%20club%20logo.png"
                alt="Bounce Party Club"
                className="h-14 w-14 object-contain"
              />
              <div>
                <h1 className="text-2xl font-bold">Order Changes Require Approval</h1>
                <p className="text-sm opacity-90 mt-1">
                  Order #{formatOrderId(order.id)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-amber-900 font-medium mb-1">Your order has been updated</p>
              <p className="text-sm text-amber-800">
                Please review the changes below and choose to approve or reject them.
                If you reject, your order will be cancelled.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-slate-900">Event Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <span className="text-slate-700">
                    {order.event_date
                      ? format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')
                      : 'No date'}
                  </span>
                </div>
                {order.addresses && (
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                    <span className="text-slate-700">
                      {order.addresses.line1}, {order.addresses.city}, {order.addresses.state}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {orderSummary?.items && orderSummary.items.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Items
                </h3>
                <div className="space-y-2">
                  {orderSummary.items.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-slate-700">
                        {item.name} ({item.mode}) &times; {item.qty}
                      </span>
                      <span className="font-medium text-slate-900">
                        {formatCurrency(item.lineTotal)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Updated Pricing</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(order.subtotal_cents || 0)}</span>
                </div>
                {(order.travel_fee_cents || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Travel Fee</span>
                    <span className="font-medium">{formatCurrency(order.travel_fee_cents)}</span>
                  </div>
                )}
                {(order.surface_fee_cents || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Surface Fee</span>
                    <span className="font-medium">{formatCurrency(order.surface_fee_cents)}</span>
                  </div>
                )}
                {(order.generator_fee_cents || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Generator Fee</span>
                    <span className="font-medium">{formatCurrency(order.generator_fee_cents)}</span>
                  </div>
                )}
                {(order.same_day_pickup_fee_cents || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Same Day Pickup</span>
                    <span className="font-medium">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                  </div>
                )}
                {(order.tax_cents || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tax</span>
                    <span className="font-medium">{formatCurrency(order.tax_cents)}</span>
                  </div>
                )}
                {(order.discount_cents || 0) > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount</span>
                    <span className="font-medium">-{formatCurrency(order.discount_cents)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-300 font-semibold">
                  <span>Total</span>
                  <span className="text-lg">{formatCurrency(currentTotalCents)}</span>
                </div>
                <div className="flex justify-between text-blue-700">
                  <span>Minimum Deposit</span>
                  <span className="font-medium">{formatCurrency(currentDepositCents)}</span>
                </div>
              </div>
            </div>

            {recentChanges.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">What Changed</h3>
                <ul className="space-y-1">
                  {recentChanges.map((change: any, i: number) => (
                    <li key={i} className="text-sm text-blue-800">
                      <span className="font-medium capitalize">{(change.field_changed || '').replace(/_/g, ' ')}</span>
                      {change.old_value && change.new_value && (
                        <span> changed from {change.old_value} to {change.new_value}</span>
                      )}
                      {!change.old_value && change.new_value && (
                        <span>: {change.new_value} added</span>
                      )}
                      {change.old_value && !change.new_value && (
                        <span>: {change.old_value} removed</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!alreadyPaidDeposit && (
              <>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-3">Payment Amount</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      paymentAmount === 'deposit' ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:border-blue-400'
                    }`}>
                      <input
                        type="radio"
                        name="paymentAmount"
                        value="deposit"
                        checked={paymentAmount === 'deposit'}
                        onChange={() => setPaymentAmount('deposit')}
                        className="sr-only"
                      />
                      <span className="font-semibold text-slate-900">Minimum Deposit</span>
                      <span className="text-lg font-bold text-blue-600 mt-1">{formatCurrency(currentDepositCents)}</span>
                      <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
                    </label>

                    <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      paymentAmount === 'full' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                    }`}>
                      <input
                        type="radio"
                        name="paymentAmount"
                        value="full"
                        checked={paymentAmount === 'full'}
                        onChange={() => setPaymentAmount('full')}
                        className="sr-only"
                      />
                      <span className="font-semibold text-slate-900">Full Payment</span>
                      <span className="text-lg font-bold text-green-600 mt-1">{formatCurrency(currentTotalCents)}</span>
                      <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
                    </label>

                    <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all sm:col-span-2 ${
                      paymentAmount === 'custom' ? 'border-teal-600 bg-teal-50' : 'border-slate-300 hover:border-teal-400'
                    }`}>
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
                            min={(currentDepositCents / 100).toFixed(2)}
                            max={(currentTotalCents / 100).toFixed(2)}
                            value={customPaymentAmount}
                            onChange={(e) => setCustomPaymentAmount(e.target.value)}
                            placeholder={(currentDepositCents / 100).toFixed(2)}
                            className="w-full pl-7 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900 mb-3">Add a Tip for the Crew</h3>
                  <TipSelector
                    totalCents={currentTotalCents}
                    tipAmount={tipAmount}
                    customTipAmount={customTipAmount}
                    onTipAmountChange={setTipAmount}
                    onCustomTipAmountChange={setCustomTipAmount}
                    formatCurrency={formatCurrency}
                  />
                </div>
              </>
            )}

            {alreadyPaidDeposit && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-900 font-medium">
                  You already paid {formatCurrency(order.deposit_paid_cents || 0)}.
                </p>
                <p className="text-sm text-green-800 mt-1">
                  Any price changes will be added to your remaining balance.
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => setShowRejectionModal(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                <XCircle className="w-5 h-5" />
                Reject Changes
              </button>
              <button
                onClick={() => setShowApprovalModal(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                <CheckCircle className="w-5 h-5" />
                Approve Changes
              </button>
            </div>

            {order.admin_message && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-blue-700 mb-1">Message from Bounce Party Club</p>
                <p className="text-sm text-blue-900">{order.admin_message}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ApprovalModal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        order={order}
        onSuccess={onApprovalSuccess}
        selectedPaymentCents={selectedPaymentCents}
        selectedPaymentBaseCents={selectedPaymentBaseCents}
        newTipCents={newTipCents}
        keepOriginalPayment={keepOriginalPayment}
      />

      <RejectionModal
        isOpen={showRejectionModal}
        onClose={() => setShowRejectionModal(false)}
        order={order}
        onSuccess={onRejectionSuccess}
      />
    </div>
  );
}
