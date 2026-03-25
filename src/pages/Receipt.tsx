import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertCircle, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { formatOrderId } from '../lib/utils';
import { OrderSummary } from '../components/order/OrderSummary';
import type { OrderSummaryDisplay } from '../lib/orderSummary';
import { buildOrderSummaryDisplay } from '../lib/orderSummaryHelpers';
import { formatTime } from '../lib/orderUtils';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export function Receipt() {
  const { orderId, paymentId } = useParams();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [summary, setSummary] = useState<OrderSummaryDisplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReceiptData();
  }, [orderId, paymentId]);

  async function loadReceiptData() {
    try {
      setLoading(true);
      setError(null);

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*, customers(*), addresses(*)')
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;
      if (!orderData) throw new Error('Order not found');

      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .eq('order_id', orderId)
        .single();

      if (paymentError) throw paymentError;
      if (!paymentData) throw new Error('Payment not found');

      const { data: orderItems } = await supabase
        .from('order_items')
        .select('*, units(*)')
        .eq('order_id', orderId);

      const { data: discounts } = await supabase
        .from('order_discounts')
        .select('*')
        .eq('order_id', orderId);

      const { data: customFees } = await supabase
        .from('order_custom_fees')
        .select('*')
        .eq('order_id', orderId);

      const summaryData = buildOrderSummaryDisplay({
        items: (orderItems || []).map((item: any) => ({
          name: item.units?.name || 'Unknown Unit',
          mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
          price: item.unit_price_cents || 0,
          qty: item.qty || 1,
        })),
        fees: {
          travel_fee_cents: orderData.travel_fee_cents,
          travel_total_miles: orderData.travel_total_miles,
          travel_fee_display_name: orderData.travel_fee_display_name,
          surface_fee_cents: orderData.surface_fee_cents,
          same_day_pickup_fee_cents: orderData.same_day_pickup_fee_cents,
          generator_fee_cents: orderData.generator_fee_cents,
          generator_qty: orderData.generator_qty,
          travel_fee_waived: orderData.travel_fee_waived,
          surface_fee_waived: orderData.surface_fee_waived,
          same_day_pickup_fee_waived: orderData.same_day_pickup_fee_waived,
          generator_fee_waived: orderData.generator_fee_waived,
        },
        discounts: (discounts || []).map((d: any) => ({
          name: d.name,
          amount_cents: d.amount_cents,
          percentage: d.percentage,
        })),
        customFees: (customFees || []).map((f: any) => ({
          name: f.name,
          amount_cents: f.amount_cents,
        })),
        subtotal_cents: orderData.subtotal_cents || 0,
        tax_cents: orderData.tax_cents || 0,
        tip_cents: orderData.tip_cents || 0,
        total_cents: (orderData.subtotal_cents || 0)
          + (orderData.travel_fee_waived ? 0 : (orderData.travel_fee_cents || 0))
          + (orderData.surface_fee_waived ? 0 : (orderData.surface_fee_cents || 0))
          + (orderData.same_day_pickup_fee_waived ? 0 : (orderData.same_day_pickup_fee_cents || 0))
          + (orderData.generator_fee_waived ? 0 : (orderData.generator_fee_cents || 0))
          + (orderData.tax_waived ? 0 : (orderData.tax_cents || 0))
          + ((customFees || []).reduce((s: number, f: any) => s + (f.amount_cents || 0), 0))
          - ((discounts || []).reduce((s: number, d: any) => {
              if (d.percentage && d.percentage > 0) return s + Math.round((orderData.subtotal_cents || 0) * (d.percentage / 100));
              return s + (d.amount_cents || 0);
            }, 0)),
        deposit_due_cents: orderData.deposit_due_cents || 0,
        deposit_paid_cents: orderData.deposit_paid_cents || 0,
        balance_due_cents: orderData.balance_due_cents || 0,
        event_date: orderData.event_date,
        event_end_date: orderData.event_end_date,
        pickup_preference: orderData.pickup_preference,
      });

      setOrder(orderData);
      setPayment(paymentData);
      setSummary(summaryData);
    } catch (err: any) {
      console.error('Error loading receipt:', err);
      setError(err.message || 'Failed to load receipt');
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !order || !payment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center bg-white rounded-lg shadow-lg p-10 max-w-md">
          <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Receipt Not Found</h1>
          <p className="text-slate-600">{error || 'Unable to load receipt'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 print:py-0 print:bg-white">
      <div className="max-w-4xl mx-auto px-4 print:px-0">
        <div className="mb-6 print:hidden">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <Printer className="w-5 h-5" />
            Print / Save PDF
          </button>
        </div>

        <div className="bg-white shadow-lg rounded-lg p-8 print:shadow-none print:rounded-none">
          <div className="text-center pb-6 border-b border-slate-200">
            <img
              src="/bounce%20party%20club%20logo.png"
              alt="Bounce Party Club"
              className="h-20 mx-auto mb-3 object-contain"
            />
            <h1 className="text-2xl font-bold text-slate-900">Payment Receipt</h1>
            <p className="text-slate-600 mt-1">(313) 889-3860</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm bg-blue-50 p-4 rounded-lg mt-6">
            <div>
              <p className="text-slate-600">Payment Received</p>
              <p className="font-semibold text-slate-900">
                {format(new Date(payment.paid_at || payment.created_at), 'MMM d, yyyy h:mm a')}
              </p>
            </div>
            <div>
              <p className="text-slate-600">Order ID</p>
              <p className="font-semibold text-slate-900 text-xs">
                #{formatOrderId(order.id)}
              </p>
            </div>
          </div>

          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mt-4">
            <div className="text-sm font-medium text-blue-900">
              Payment Type: {
                payment.type === 'deposit' ? 'Deposit Payment' :
                payment.type === 'balance' && order.balance_due_cents === 0 && (order.balance_paid_cents === 0 || order.balance_paid_cents === null) ? 'Crew Tip Payment' :
                payment.type === 'balance' && payment.amount_cents <= (order.tip_cents || 0) && order.balance_due_cents === 0 ? 'Crew Tip Payment' :
                'Final Balance Payment'
              }
            </div>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200 mt-4">
            <div className="space-y-2">
              {order.tip_cents > 0 && payment.type === 'deposit' && (
                <>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-700">Order Amount:</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(payment.amount_cents - (order.tip_cents || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-700">Crew Tip:</span>
                    <span className="font-medium text-green-600">
                      {formatCurrency(order.tip_cents)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-green-200"></div>
                </>
              )}
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-slate-900">Total Paid</span>
                <span className="text-2xl font-bold text-green-600">
                  {formatCurrency(payment.amount_cents)}
                </span>
              </div>
            </div>
            {payment.payment_method && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">Payment Method:</span>
                  <span className="font-medium text-slate-900">
                    {(() => {
                      const method = payment.payment_method;
                      const brand = payment.payment_brand;
                      const lastFour = payment.payment_last4;

                      if (method === 'card' && brand) {
                        const brandName = brand.charAt(0).toUpperCase() + brand.slice(1);
                        return lastFour ? `${brandName} ****${lastFour}` : brandName;
                      }
                      if (method === 'apple_pay') return 'Apple Pay';
                      if (method === 'google_pay') return 'Google Pay';
                      if (method === 'link') return 'Link';
                      if (method === 'us_bank_account') return 'Bank Account';
                      if (method === 'cash') return 'Cash';
                      if (method === 'check') return 'Check';
                      return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    })()}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200 mt-6">
            <h4 className="font-semibold text-slate-900 mb-3">Customer Information</h4>
            <div className="text-sm space-y-2">
              <p>
                <span className="text-slate-600">Name: </span>
                <span className="font-medium text-slate-900">
                  {order.customers.first_name} {order.customers.last_name}
                </span>
              </p>
              <p>
                <span className="text-slate-600">Email: </span>
                <span className="font-medium text-slate-900">{order.customers.email}</span>
              </p>
              <p>
                <span className="text-slate-600">Phone: </span>
                <span className="font-medium text-slate-900">{order.customers.phone}</span>
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 mt-6">
            <h4 className="font-semibold text-slate-900 mb-3">Event Information</h4>
            <div className="text-sm space-y-2">
              <p>
                <span className="text-slate-600">Date: </span>
                <span className="font-medium text-slate-900">
                  {format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
                  {order.event_end_date && order.event_end_date !== order.event_date && (
                    <> - {format(new Date(order.event_end_date + 'T12:00:00'), 'MMMM d, yyyy')}</>
                  )}
                </span>
              </p>
              {(order.start_window || order.end_window || order.event_start_time || order.event_end_time) && (
                <p>
                  <span className="text-slate-600">Time: </span>
                  <span className="font-medium text-slate-900">
                    {(order.start_window || order.event_start_time) && formatTime(order.start_window || order.event_start_time)}
                    {(order.start_window || order.event_start_time) && (order.end_window || order.event_end_time) && ' - '}
                    {(order.end_window || order.event_end_time) && formatTime(order.end_window || order.event_end_time)}
                  </span>
                </p>
              )}
              {order.addresses && (
                <p>
                  <span className="text-slate-600">Location: </span>
                  <span className="font-medium text-slate-900">
                    {order.addresses.line1}, {order.addresses.city}, {order.addresses.state} {order.addresses.zip}
                  </span>
                </p>
              )}
              {order.pickup_preference && (
                <p>
                  <span className="text-slate-600">Pickup: </span>
                  <span className="font-medium text-slate-900">
                    {order.pickup_preference === 'same_day' ? 'Same Day Pickup' : 'Next Day Pickup'}
                  </span>
                </p>
              )}
            </div>
          </div>

          {summary && (
            <div className="pt-4 border-t-2 border-slate-300 mt-6">
              <OrderSummary
                summary={summary}
                title="Complete Order Details"
                showDeposit={false}
                showTip={true}
              />
            </div>
          )}

          <div className="pt-4 border-t-2 border-slate-300 mt-6">
            <h4 className="font-semibold text-slate-900 mb-3">Payment Status</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-700">Deposit Paid:</span>
                <span className="font-medium text-green-600">{formatCurrency(order.deposit_paid_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-700">Balance Paid:</span>
                <span className="font-medium text-green-600">{formatCurrency(order.balance_paid_cents)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-lg">
                <span className="text-slate-900">Remaining Balance:</span>
                <span className="text-blue-700">
                  {formatCurrency(order.balance_due_cents || 0)}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200 mt-6 text-center text-sm text-slate-600">
            <p>Thank you for your business!</p>
            <p className="mt-2">Questions? Contact us at (313) 889-3860</p>
          </div>
        </div>
      </div>
    </div>
  );
}
