import { useState } from 'react';
import { CreditCard, DollarSign, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { formatCurrency } from '../lib/pricing';

interface Payment {
  id: string;
  amount_cents: number;
  payment_type: string;
  status: string;
  description: string;
  created_at: string;
}

interface Order {
  id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  deposit_paid_cents: number;
  balance_paid_cents: number;
  damage_charged_cents: number;
  total_refunded_cents: number;
  balance_due_cents: number;
}

interface PaymentManagementProps {
  order: Order;
  payments: Payment[];
  onRefresh: () => void;
}

export function PaymentManagement({ order, payments, onRefresh }: PaymentManagementProps) {
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [chargeType, setChargeType] = useState<'balance' | 'damage'>('balance');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const hasPaymentMethod = order.stripe_customer_id && order.stripe_payment_method_id;

  const handleCharge = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasPaymentMethod) {
      setMessage({ type: 'error', text: 'No payment method on file' });
      return;
    }

    const amountCents = Math.round(parseFloat(chargeAmount) * 100);
    if (amountCents <= 0) {
      setMessage({ type: 'error', text: 'Invalid amount' });
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-charge`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: order.id,
          amountCents,
          paymentType: chargeType,
          description: chargeDescription || `${chargeType} charge`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process charge');
      }

      setMessage({ type: 'success', text: `Successfully charged ${formatCurrency(amountCents)}` });
      setShowChargeForm(false);
      setChargeAmount('');
      setChargeDescription('');
      onRefresh();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to process charge' });
    } finally {
      setProcessing(false);
    }
  };

  const totalPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);
  const totalCharged = totalPaid + (order.damage_charged_cents || 0);
  const totalRefunded = order.total_refunded_cents || 0;

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center">
        <CreditCard className="w-5 h-5 mr-2 text-blue-600" />
        Payment Management
      </h3>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-sm text-green-700 mb-1">Total Paid</div>
          <div className="text-2xl font-bold text-green-900">{formatCurrency(totalPaid)}</div>
          <div className="text-xs text-green-600 mt-1">
            Deposit: {formatCurrency(order.deposit_paid_cents || 0)}<br />
            Balance: {formatCurrency(order.balance_paid_cents || 0)}
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-sm text-slate-700 mb-1">Balance Due</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(order.balance_due_cents)}</div>
        </div>

        {(order.damage_charged_cents || 0) > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="text-sm text-orange-700 mb-1">Damage Charges</div>
            <div className="text-2xl font-bold text-orange-900">{formatCurrency(order.damage_charged_cents)}</div>
          </div>
        )}

        {totalRefunded > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-sm text-red-700 mb-1">Refunded</div>
            <div className="text-2xl font-bold text-red-900">{formatCurrency(totalRefunded)}</div>
          </div>
        )}
      </div>

      {message && (
        <div className={`mb-4 p-4 rounded-lg border ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-900'
            : 'bg-red-50 border-red-200 text-red-900'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 inline mr-2" />
          ) : (
            <AlertCircle className="w-5 h-5 inline mr-2" />
          )}
          {message.text}
        </div>
      )}

      {hasPaymentMethod ? (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-start">
            <CheckCircle className="w-5 h-5 text-blue-600 mr-2 mt-0.5" />
            <div className="text-sm text-blue-900">
              <strong>Payment method on file</strong><br />
              You can charge the customer's card for remaining balance or damage fees.
            </div>
          </div>

          {!showChargeForm ? (
            <button
              onClick={() => setShowChargeForm(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
            >
              <DollarSign className="w-5 h-5 mr-2" />
              Charge Card on File
            </button>
          ) : (
            <form onSubmit={handleCharge} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Charge Type *
                </label>
                <select
                  value={chargeType}
                  onChange={(e) => setChargeType(e.target.value as 'balance' | 'damage')}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="balance">Remaining Balance</option>
                  <option value="damage">Damage/Cleaning Fee</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Amount * ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0.00"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Description
                </label>
                <textarea
                  value={chargeDescription}
                  onChange={(e) => setChargeDescription(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Optional description for this charge"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-5 h-5 mr-2" />
                      Charge ${chargeAmount || '0.00'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowChargeForm(false);
                    setMessage(null);
                  }}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="w-5 h-5 text-yellow-600 mr-2 mt-0.5" />
          <div className="text-sm text-yellow-900">
            <strong>No payment method on file</strong><br />
            Customer needs to complete payment first before you can charge additional fees.
          </div>
        </div>
      )}

      {payments.length > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-6">
          <h4 className="font-semibold text-slate-900 mb-3">Payment History</h4>
          <div className="space-y-2">
            {payments.map((payment) => (
              <div key={payment.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-slate-900 capitalize">
                    {payment.payment_type?.replace('_', ' ') || 'Payment'}
                  </div>
                  {payment.description && (
                    <div className="text-xs text-slate-600">{payment.description}</div>
                  )}
                  <div className="text-xs text-slate-500">
                    {new Date(payment.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${
                    payment.status === 'succeeded' ? 'text-green-600' :
                    payment.status === 'failed' ? 'text-red-600' : 'text-slate-600'
                  }`}>
                    {formatCurrency(payment.amount_cents)}
                  </div>
                  <div className={`text-xs capitalize ${
                    payment.status === 'succeeded' ? 'text-green-600' :
                    payment.status === 'failed' ? 'text-red-600' : 'text-slate-600'
                  }`}>
                    {payment.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
