import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { FileText, CreditCard, CheckCircle, Image as ImageIcon, MapPin, Printer, Calendar, MapPin as MapPinIcon, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import WaiverTab from '../waiver/WaiverTab';
import { PaymentTab } from './PaymentTab';
import { PicturesTab } from './PicturesTab';
import { LotPicturesTab } from './LotPicturesTab';
import { CancelOrderModal } from './CancelOrderModal';
import { ReceiptModal } from '../dashboard/ReceiptModal';
import { showToast } from '../../lib/notifications';

interface RegularPortalViewProps {
  order: any;
  orderId: string;
  orderItems: any[];
  orderSummary: any;
  onReload: () => void;
}

export function RegularPortalView({ order, orderId, orderItems, orderSummary, onReload }: RegularPortalViewProps) {
  const navigate = useNavigate();
  const isPendingReview = order.status === 'pending_review';
  const lotPicturesRequested = order.lot_pictures_requested || false;
  const [activeTab, setActiveTab] = useState<'details' | 'lot-pictures' | 'waiver' | 'payment' | 'pictures'>('details');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [lotPicturesUploaded, setLotPicturesUploaded] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  useEffect(() => {
    loadPayments();
    loadLotPictures();

    // Check URL params for payment status
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');

    if (paymentStatus === 'success') {
      showToast('Payment successful! Thank you.', 'success');
      onReload();
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'canceled') {
      showToast('Payment was canceled. You can try again anytime.', 'info');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onReload]);

  async function loadPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error loading payments:', error);
    }
  }

  async function loadLotPictures() {
    try {
      const { data, error } = await supabase
        .from('order_lot_pictures' as any)
        .select('id')
        .eq('order_id', orderId)
        .limit(1);

      if (error) throw error;
      setLotPicturesUploaded((data || []).length > 0);
    } catch (error) {
      console.error('Error loading lot pictures:', error);
    }
  }

  const balanceDue = order.balance_due_cents - (order.balance_paid_cents || 0);
  const needsWaiver = !order.waiver_signed_at;
  const needsPayment = balanceDue > 0;
  const canCancel = ['draft', 'pending_review', 'awaiting_customer_approval', 'confirmed'].includes(
    order.status
  );

  async function handlePayment() {
    try {
      // Create a Stripe Checkout session for balance payment
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-balance-payment`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: orderId,
          amountCents: balanceDue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create payment session');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      showToast(error.message || 'Failed to process payment', 'error');
    }
  }

  async function handleSubmitPictures(files: File[], notes: string) {
    try {
      const uploadPromises = files.map(async (file) => {
        // Create unique file path
        const fileExt = file.name.split('.').pop();
        const fileName = `${orderId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('order-pictures')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Save metadata to database
        const { error: dbError } = await supabase
          .from('order_pictures' as any)
          .insert({
            order_id: orderId,
            file_path: fileName,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            notes: notes || null,
            uploaded_by: null, // Anonymous upload from customer portal
          });

        if (dbError) throw dbError;

        return fileName;
      });

      await Promise.all(uploadPromises);

      showToast(
        `Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`,
        'success'
      );
    } catch (error) {
      console.error('Error submitting pictures:', error);
      showToast('Failed to upload pictures. Please try again.', 'error');
      throw error;
    }
  }

  const totalPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);
  const successfulPayments = payments.filter(p => p.status === 'succeeded');

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-white">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate('/')}
                  className="hover:opacity-80 transition-opacity flex-shrink-0"
                  title="Return to Home"
                >
                  <img
                    src="/bounce%20party%20club%20logo.png"
                    alt="Bounce Party Club"
                    className="h-16 w-16 object-contain"
                  />
                </button>
                <div>
                  <h1 className="text-3xl font-bold">Customer Portal</h1>
                  <p className="mt-2">Order #{formatOrderId(order.id)}</p>
                  <p className="text-sm opacity-90">
                    Event Date: {format(new Date(order.event_date), 'MMMM d, yyyy')} at{' '}
                    {order.start_window}
                  </p>
                </div>
              </div>
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors text-sm"
                >
                  Cancel Order
                </button>
              )}
            </div>
          </div>

          <div className="px-8 py-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Complete These Steps</h2>
              <div className={`grid grid-cols-1 ${lotPicturesRequested ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 mb-4`}>
                {lotPicturesRequested && (
                  <button
                    onClick={() => setActiveTab('lot-pictures')}
                    className={`border rounded-lg p-4 transition-all ${
                      !lotPicturesUploaded
                        ? 'border-amber-500 bg-amber-50 hover:border-amber-600'
                        : 'border-green-500 bg-green-50 hover:border-green-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {!lotPicturesUploaded ? (
                        <MapPin className="w-6 h-6 text-amber-600" />
                      ) : (
                        <CheckCircle className="w-6 h-6 text-green-600" />
                      )}
                      <div className="text-left">
                        <p className="font-semibold text-slate-900">Lot Pictures</p>
                        <p className="text-xs text-slate-600">
                          {!lotPicturesUploaded ? 'Required' : 'Complete'}
                        </p>
                      </div>
                    </div>
                  </button>
                )}

                <button
                  onClick={() => totalPaid > 0 && setActiveTab('waiver')}
                  disabled={totalPaid === 0}
                  className={`border rounded-lg p-4 transition-all ${
                    totalPaid === 0
                      ? 'border-slate-300 bg-slate-100 cursor-not-allowed opacity-60'
                      : needsWaiver
                      ? 'border-amber-500 bg-amber-50 hover:border-amber-600'
                      : 'border-green-500 bg-green-50 hover:border-green-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {needsWaiver ? (
                      <FileText className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div className="text-left">
                      <p className="font-semibold text-slate-900">Sign Waiver</p>
                      <p className="text-xs text-slate-600">
                        {needsWaiver ? 'Required' : 'Complete'}
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => totalPaid > 0 && setActiveTab('payment')}
                  disabled={totalPaid === 0}
                  className={`border rounded-lg p-4 transition-all ${
                    totalPaid === 0
                      ? 'border-slate-300 bg-slate-100 cursor-not-allowed opacity-60'
                      : needsPayment
                      ? 'border-amber-500 bg-amber-50 hover:border-amber-600'
                      : 'border-green-500 bg-green-50 hover:border-green-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {needsPayment ? (
                      <CreditCard className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div className="text-left">
                      <p className="font-semibold text-slate-900">Payment</p>
                      <p className="text-xs text-slate-600">
                        {needsPayment ? `${formatCurrency(balanceDue)} due` : 'Complete'}
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => totalPaid > 0 && setActiveTab('pictures')}
                  disabled={totalPaid === 0}
                  className={`border rounded-lg p-4 transition-all ${
                    totalPaid === 0
                      ? 'border-slate-300 bg-slate-100 cursor-not-allowed opacity-60'
                      : 'border-slate-300 bg-slate-50 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                    <div className="text-left">
                      <p className="font-semibold text-slate-900">Pictures</p>
                      <p className="text-xs text-slate-600">Optional</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex gap-2 mb-6 border-b border-slate-200 overflow-x-auto">
              <button
                onClick={() => setActiveTab('details')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === 'details'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Order Details
              </button>
              <button
                onClick={() => setActiveTab('lot-pictures')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'lot-pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapPin className="w-4 h-4" />
                Lot Pictures
              </button>
              <button
                onClick={() => totalPaid > 0 && setActiveTab('waiver')}
                disabled={totalPaid === 0}
                className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
                  totalPaid === 0
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'waiver'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Waiver
              </button>
              <button
                onClick={() => totalPaid > 0 && setActiveTab('payment')}
                disabled={totalPaid === 0}
                className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
                  totalPaid === 0
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'payment'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Payment
              </button>
              <button
                onClick={() => totalPaid > 0 && setActiveTab('pictures')}
                disabled={totalPaid === 0}
                className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
                  totalPaid === 0
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Pictures
              </button>
            </div>

            {activeTab === 'details' && (
              <div className="space-y-6">
                {totalPaid === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 font-medium">Order Pending Approval</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Your order is pending approval. Payment will be required once approved.
                    </p>
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Order Information</h3>

                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Event Date</p>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        <p className="font-medium text-slate-900">
                          {format(new Date(order.event_date), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-slate-600 mb-1">Time Window</p>
                      <p className="font-medium text-slate-900">{order.start_window}</p>
                    </div>
                  </div>

                  {order.addresses && (
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Event Location</p>
                      <div className="flex items-start gap-2">
                        <MapPinIcon className="w-4 h-4 text-blue-600 mt-0.5" />
                        <p className="font-medium text-slate-900">
                          {order.addresses.line1}
                          {order.addresses.line2 && `, ${order.addresses.line2}`}
                          <br />
                          {order.addresses.city}, {order.addresses.state} {order.addresses.zip}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>

                  {orderItems && orderItems.length > 0 && (
                    <div className="mb-4 pb-4 border-b border-slate-300">
                      <p className="text-sm font-semibold text-slate-700 mb-2">Items:</p>
                      {orderItems.map((item: any) => {
                        const itemTotal = (item.price_per_unit_per_day_cents || 0) * (item.quantity || 1) * (item.rental_days || 1);
                        return (
                          <div key={item.id} className="flex justify-between text-sm mb-1">
                            <span className="text-slate-600">
                              {item.units?.name || 'Item'} × {item.quantity || 1} ({item.rental_days || 1} day{item.rental_days > 1 ? 's' : ''})
                            </span>
                            <span className="font-medium text-slate-900">
                              {formatCurrency(itemTotal)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.subtotal_cents)}
                      </span>
                    </div>
                    {order.travel_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Travel Fee:</span>
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(order.travel_fee_cents)}
                        </span>
                      </div>
                    )}
                    {order.surface_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Surface Fee:</span>
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(order.surface_fee_cents)}
                        </span>
                      </div>
                    )}
                    {order.tax_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tax:</span>
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(order.tax_cents)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-300">
                      <span className="font-semibold text-slate-900">Total:</span>
                      <span className="text-lg font-bold text-slate-900">
                        {formatCurrency(
                          order.subtotal_cents +
                          order.travel_fee_cents +
                          order.surface_fee_cents +
                          order.same_day_pickup_fee_cents +
                          order.tax_cents
                        )}
                      </span>
                    </div>
                    {totalPaid > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Already Paid:</span>
                          <span className="font-semibold text-green-700">
                            {formatCurrency(totalPaid)}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-slate-300">
                          <span className="font-semibold text-slate-900">Balance Due:</span>
                          <span className="text-xl font-bold text-blue-600">
                            {formatCurrency(balanceDue)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {successfulPayments.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Receipts</h3>
                    <div className="space-y-3">
                      {successfulPayments.map((payment) => (
                        <div
                          key={payment.id}
                          className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-4"
                        >
                          <div>
                            <p className="font-medium text-slate-900">
                              {formatCurrency(payment.amount_cents)}
                            </p>
                            <p className="text-xs text-slate-600">
                              {format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}
                            </p>
                            <p className="text-xs text-slate-500">
                              {payment.payment_method === 'card' ? 'Credit Card' : payment.payment_method}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              // Open receipt in new tab for printing
                              const receiptWindow = window.open('', '_blank');
                              if (receiptWindow) {
                                receiptWindow.document.write(`
                                  <!DOCTYPE html>
                                  <html>
                                    <head>
                                      <title>Payment Receipt - Order #${order.order_number}</title>
                                      <meta charset="utf-8">
                                      <meta name="viewport" content="width=device-width, initial-scale=1">
                                      <style>
                                        * { margin: 0; padding: 0; box-sizing: border-box; }
                                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
                                        .header { text-align: center; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 2px solid #e2e8f0; }
                                        .header img { height: 80px; margin-bottom: 16px; }
                                        .header h1 { font-size: 24px; font-weight: bold; color: #1e293b; }
                                        .header p { color: #64748b; margin-top: 8px; }
                                        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; padding: 20px; background: #eff6ff; border-radius: 8px; }
                                        .info-item { }
                                        .info-label { color: #64748b; font-size: 14px; margin-bottom: 4px; }
                                        .info-value { font-weight: 600; color: #1e293b; font-size: 16px; }
                                        .amount-box { padding: 24px; background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 8px; margin-bottom: 32px; }
                                        .amount-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
                                        .amount-row:last-child { margin-bottom: 0; padding-top: 12px; border-top: 1px solid #bbf7d0; }
                                        .amount-label { font-size: 14px; color: #374151; }
                                        .amount-value { font-weight: 600; color: #1e293b; }
                                        .amount-total { font-size: 20px; font-weight: bold; }
                                        .amount-total .amount-value { color: #16a34a; font-size: 28px; }
                                        .payment-method { padding: 16px; background: #f8fafc; border-radius: 8px; margin-bottom: 32px; display: flex; justify-content: space-between; }
                                        .footer { text-align: center; padding-top: 32px; border-top: 2px solid #e2e8f0; color: #64748b; font-size: 14px; }
                                        @media print {
                                          body { padding: 20px; }
                                          @page { margin: 0.5in; }
                                        }
                                      </style>
                                    </head>
                                    <body>
                                      <div class="header">
                                        <img src="/bounce%20party%20club%20logo.png" alt="Bounce Party Club" />
                                        <h1>Bounce Party Club</h1>
                                        <p>(313) 889-3860</p>
                                      </div>

                                      <div class="info-grid">
                                        <div class="info-item">
                                          <div class="info-label">Payment Received</div>
                                          <div class="info-value">${format(new Date(payment.paid_at || payment.created_at), 'MMM d, yyyy h:mm a')}</div>
                                        </div>
                                        <div class="info-item">
                                          <div class="info-label">Order ID</div>
                                          <div class="info-value">#${order.order_number}</div>
                                        </div>
                                      </div>

                                      <div class="amount-box">
                                        ${order.tip_cents > 0 && payment.type === 'deposit' ? `
                                          <div class="amount-row">
                                            <span class="amount-label">Order Amount:</span>
                                            <span class="amount-value">$${((payment.amount_cents - order.tip_cents) / 100).toFixed(2)}</span>
                                          </div>
                                          <div class="amount-row">
                                            <span class="amount-label">Crew Tip:</span>
                                            <span class="amount-value" style="color: #16a34a;">$${(order.tip_cents / 100).toFixed(2)}</span>
                                          </div>
                                        ` : ''}
                                        <div class="amount-row amount-total">
                                          <span class="amount-label">Total Paid</span>
                                          <span class="amount-value">$${(payment.amount_cents / 100).toFixed(2)}</span>
                                        </div>
                                      </div>

                                      ${payment.payment_method ? `
                                        <div class="payment-method">
                                          <span class="amount-label">Payment Method:</span>
                                          <span class="amount-value">${
                                            payment.payment_method === 'card' && payment.payment_brand
                                              ? `${payment.payment_brand.charAt(0).toUpperCase() + payment.payment_brand.slice(1)}${payment.payment_last4 ? ' ****' + payment.payment_last4 : ''}`
                                              : payment.payment_method === 'apple_pay' ? 'Apple Pay'
                                              : payment.payment_method === 'google_pay' ? 'Google Pay'
                                              : payment.payment_method.charAt(0).toUpperCase() + payment.payment_method.slice(1)
                                          }</span>
                                        </div>
                                      ` : ''}

                                      <div class="footer">
                                        <p>Thank you for your business!</p>
                                        <p style="margin-top: 8px;">Please keep this receipt for your records.</p>
                                      </div>

                                      <script>
                                        window.onload = function() {
                                          setTimeout(function() {
                                            window.print();
                                          }, 250);
                                        };
                                      </script>
                                    </body>
                                  </html>
                                `);
                                receiptWindow.document.close();
                              }
                            }}
                            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Printer className="w-4 h-4" />
                            Print Receipt
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'lot-pictures' && (
              <LotPicturesTab
                orderId={orderId}
                orderNumber={order.order_number}
                orderStatus={order.status}
                onUploadComplete={() => {
                  loadLotPictures();
                  onReload();
                }}
              />
            )}

            {activeTab === 'waiver' && <WaiverTab orderId={orderId} order={order} />}

            {activeTab === 'payment' && (
              <PaymentTab
                orderId={orderId}
                order={order}
                balanceDue={balanceDue}
                onPaymentComplete={onReload}
              />
            )}

            {activeTab === 'pictures' && <PicturesTab onSubmit={handleSubmitPictures} />}
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          <p>Questions? Call us or text us at the number provided in your confirmation.</p>
        </div>
      </div>

      {showCancelModal && (
        <CancelOrderModal
          orderId={order.id}
          eventDate={order.event_date}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => {
            onReload();
            showToast('Your order has been cancelled', 'success');
          }}
        />
      )}

      {showReceiptModal && selectedPayment && (
        <ReceiptModal
          order={order}
          payment={selectedPayment}
          summary={orderSummary}
          loading={false}
          onClose={() => {
            setShowReceiptModal(false);
            setSelectedPayment(null);
          }}
        />
      )}
    </div>
  );
}
