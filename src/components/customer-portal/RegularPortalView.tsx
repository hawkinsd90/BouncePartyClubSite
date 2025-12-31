import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { FileText, CreditCard, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { supabase } from '../../lib/supabase';
import WaiverTab from '../waiver/WaiverTab';
import { PaymentTab } from './PaymentTab';
import { PicturesTab } from './PicturesTab';
import { CancelOrderModal } from './CancelOrderModal';
import { showToast } from '../../lib/notifications';

interface RegularPortalViewProps {
  order: any;
  orderId: string;
  onReload: () => void;
}

export function RegularPortalView({ order, orderId, onReload }: RegularPortalViewProps) {
  const [activeTab, setActiveTab] = useState<'waiver' | 'payment' | 'pictures'>(
    order.waiver_signed_at ? 'payment' : 'waiver'
  );
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
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
          .from('order_pictures')
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

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-white">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold">Customer Portal</h1>
                <p className="mt-2">Order #{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-sm opacity-90">
                  Event Date: {format(new Date(order.event_date), 'MMMM d, yyyy')} at{' '}
                  {order.start_window}
                </p>
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
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                Complete These Steps
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  className={`border rounded-lg p-4 ${
                    needsWaiver
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-green-500 bg-green-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {needsWaiver ? (
                      <FileText className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">Sign Waiver</p>
                      <p className="text-xs text-slate-600">
                        {needsWaiver ? 'Required' : 'Complete'}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className={`border rounded-lg p-4 ${
                    needsPayment
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-green-500 bg-green-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {needsPayment ? (
                      <CreditCard className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">Payment</p>
                      <p className="text-xs text-slate-600">
                        {needsPayment ? `${formatCurrency(balanceDue)} due` : 'Complete'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                    <div>
                      <p className="font-semibold text-slate-900">Pictures</p>
                      <p className="text-xs text-slate-600">Optional</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mb-6 border-b border-slate-200">
              <button
                onClick={() => setActiveTab('waiver')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  activeTab === 'waiver'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Waiver
              </button>
              <button
                onClick={() => setActiveTab('payment')}
                disabled={needsWaiver}
                className={`px-4 py-2 font-medium border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  activeTab === 'payment'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Payment
              </button>
              <button
                onClick={() => setActiveTab('pictures')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  activeTab === 'pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Pictures
              </button>
            </div>

            {activeTab === 'waiver' && <WaiverTab orderId={orderId} order={order} />}

            {activeTab === 'payment' && (
              <PaymentTab order={order} balanceDue={balanceDue} onPayment={handlePayment} />
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
    </div>
  );
}
