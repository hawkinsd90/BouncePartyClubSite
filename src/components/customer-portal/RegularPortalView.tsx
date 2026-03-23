import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { FileText, CreditCard, CheckCircle, Image as ImageIcon, MapPin, Printer, Calendar, MapPin as MapPinIcon, Truck, Navigation, Clock, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import WaiverTab from '../waiver/WaiverTab';
import { PaymentTab } from './PaymentTab';
import { PicturesTab } from './PicturesTab';
import { LotPicturesTab } from './LotPicturesTab';
import { CancelOrderModal } from './CancelOrderModal';
import { DeliveryTab } from './DeliveryTab';
import { showToast } from '../../lib/notifications';
import { OrderStatusBadge } from '../dashboard/OrderStatusBadge';

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
  const [activeTab, setActiveTab] = useState<'details' | 'lot-pictures' | 'waiver' | 'payment' | 'pictures' | 'delivery'>('details');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [lotPicturesUploaded, setLotPicturesUploaded] = useState(false);
  // Preserved tip cents from a card-update redirect (?tab=payment&tip=NNN)
  const [restoredTipCents, setRestoredTipCents] = useState<number | null>(null);

  useEffect(() => {
    loadPayments();
    loadLotPictures();

    // Check URL params for payment status and preserved tip state
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const tabParam = params.get('tab');
    const tipParam = params.get('tip');
    const cardUpdated = params.get('card_updated') === 'true';

    if (tabParam === 'payment') {
      setActiveTab('payment');
      if (tipParam) {
        const parsed = parseInt(tipParam, 10);
        if (!isNaN(parsed) && parsed > 0) {
          setRestoredTipCents(parsed);
        }
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (cardUpdated) {
      // Customer returned from card-update Stripe Checkout for balance payment.
      // CustomerPortal.tsx calls save-payment-method-from-session; we just restore
      // the payment tab and any tip that was encoded in the return URL.
      setActiveTab('payment');
      if (tipParam) {
        const parsed = parseInt(tipParam, 10);
        if (!isNaN(parsed) && parsed > 0) {
          setRestoredTipCents(parsed);
        }
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'success') {
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

  const totalPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);
  const balanceDue = order.balance_due_cents - (order.balance_paid_cents || 0);
  const needsWaiver = !order.waiver_signed_at;
  const needsPayment = balanceDue > 0;
  const canCancel = ['draft', 'pending_review', 'awaiting_customer_approval', 'confirmed'].includes(
    order.status
  );
  const isConfirmed = order.status === 'confirmed';
  const stepsUnlocked = totalPaid > 0 || isConfirmed;

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

  const successfulPayments = payments.filter(p => p.status === 'succeeded');

  const workflowLabels: Record<string, { text: string; icon: React.ReactNode; headerColor: string; cardColor: string }> = {
    on_the_way:         { text: 'Crew is on the way',       icon: <Navigation className="w-3.5 h-3.5" />, headerColor: 'text-white font-semibold', cardColor: 'text-blue-700' },
    arrived:            { text: 'Crew has arrived',          icon: <Clock className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-yellow-700' },
    setup_in_progress:  { text: 'Setup in progress',         icon: <Truck className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-cyan-700' },
    setup_completed:    { text: 'Equipment delivered',       icon: <Truck className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-green-700' },
    pickup_scheduled:   { text: 'Pickup scheduled',          icon: <Package className="w-3.5 h-3.5" />,    headerColor: 'text-white font-semibold', cardColor: 'text-amber-700' },
    pickup_in_progress: { text: 'Crew picking up equipment', icon: <Navigation className="w-3.5 h-3.5" />, headerColor: 'text-white font-semibold', cardColor: 'text-orange-700' },
  };
  const activeWorkflow = order.status === 'in_progress' && order.workflow_status
    ? workflowLabels[order.workflow_status]
    : null;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 sm:px-8 py-6 text-white">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <button
                  onClick={() => navigate('/')}
                  className="hover:opacity-80 transition-opacity flex-shrink-0"
                  title="Return to Home"
                >
                  <img
                    src="/bounce%20party%20club%20logo.png"
                    alt="Bounce Party Club"
                    className="h-12 sm:h-16 w-12 sm:w-16 object-contain"
                  />
                </button>
                <div className="min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-bold">Customer Portal</h1>
                  <div className="flex items-center gap-2 mt-1 sm:mt-2 flex-wrap">
                    <p className="text-sm sm:text-base">Order #{formatOrderId(order.id)}</p>
                    <OrderStatusBadge order={order} />
                  </div>
                  {activeWorkflow && (
                    <div className={`flex items-center gap-1.5 mt-1 text-xs ${activeWorkflow.headerColor}`}>
                      {activeWorkflow.icon}
                      {activeWorkflow.text}
                    </div>
                  )}
                  <p className="text-xs sm:text-sm opacity-90 mt-1">
                    Event Date: {format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')} at{' '}
                    {order.start_window}
                  </p>
                </div>
              </div>
              {canCancel && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors text-sm whitespace-nowrap self-start sm:self-center flex-shrink-0"
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
                  onClick={() => stepsUnlocked && setActiveTab('waiver')}
                  disabled={!stepsUnlocked}
                  className={`border rounded-lg p-4 transition-all ${
                    !stepsUnlocked
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
                  onClick={() => stepsUnlocked && setActiveTab('payment')}
                  disabled={!stepsUnlocked}
                  className={`border rounded-lg p-4 transition-all ${
                    !stepsUnlocked
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
                  onClick={() => stepsUnlocked && setActiveTab('pictures')}
                  disabled={!stepsUnlocked}
                  className={`border rounded-lg p-4 transition-all ${
                    !stepsUnlocked
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

            <div className="relative mb-6">
              <div className="pointer-events-none absolute left-0 top-0 bottom-2 w-6 bg-gradient-to-r from-white to-transparent z-10 sm:hidden" />
              <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-10 bg-gradient-to-l from-white to-transparent z-10" />
              <p className="text-xs text-slate-400 mb-1 sm:hidden flex items-center gap-1">
                <span>&#8592;</span> Swipe tabs to see more <span>&#8594;</span>
              </p>
            <div className="flex gap-1 border-b border-slate-200 overflow-x-auto scrollbar-hide pb-0">
              <button
                onClick={() => setActiveTab('details')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap text-sm ${
                  activeTab === 'details'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab('lot-pictures')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap text-sm ${
                  activeTab === 'lot-pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                Lot Pics
              </button>
              <button
                onClick={() => stepsUnlocked && setActiveTab('waiver')}
                disabled={!stepsUnlocked}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap text-sm relative ${
                  !stepsUnlocked
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'waiver'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Waiver
                {needsWaiver && stepsUnlocked && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => stepsUnlocked && setActiveTab('payment')}
                disabled={!stepsUnlocked}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap text-sm relative ${
                  !stepsUnlocked
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'payment'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Payment
                {needsPayment && stepsUnlocked && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => stepsUnlocked && setActiveTab('pictures')}
                disabled={!stepsUnlocked}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap text-sm ${
                  !stepsUnlocked
                    ? 'border-transparent text-slate-400 cursor-not-allowed'
                    : activeTab === 'pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Pictures
              </button>
              <button
                onClick={() => setActiveTab('delivery')}
                className={`px-3 py-2.5 font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap text-sm ${
                  activeTab === 'delivery'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                Delivery
              </button>
            </div>
            </div>

            {activeTab === 'details' && (
              <div className="space-y-6">
                {totalPaid === 0 && order.status === 'pending_review' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 font-medium">Order Pending Approval</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Your order is pending approval. Payment will be required once approved.
                    </p>
                  </div>
                )}

                {order.status === 'in_progress' && order.workflow_status === 'on_the_way' && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 flex items-start gap-3">
                    <Navigation className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-900">Crew is on the way!</p>
                      <p className="text-sm text-blue-700 mt-1">Your equipment is en route. The crew will arrive shortly.</p>
                    </div>
                  </div>
                )}

                {order.status === 'in_progress' && order.workflow_status === 'arrived' && (
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3">
                    <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-yellow-900">Crew has arrived</p>
                      <p className="text-sm text-yellow-700 mt-1">The crew is at your location setting up the equipment.</p>
                    </div>
                  </div>
                )}

                {order.status === 'in_progress' && order.workflow_status === 'setup_completed' && (
                  <div className="bg-green-50 border border-green-300 rounded-lg p-4 flex items-start gap-3">
                    <Truck className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-green-900">Equipment Delivered!</p>
                      <p className="text-sm text-green-700 mt-1">
                        Your equipment has been set up and delivered. Enjoy your event! Check the Delivery tab for proof of delivery photos.
                      </p>
                    </div>
                  </div>
                )}

                {order.status === 'in_progress' && order.workflow_status === 'pickup_in_progress' && (
                  <div className="bg-orange-50 border border-orange-300 rounded-lg p-4 flex items-start gap-3">
                    <Navigation className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-orange-900">Pickup in Progress</p>
                      <p className="text-sm text-orange-700 mt-1">The crew is on their way to pick up the equipment. Thank you!</p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900">Order Information</h3>
                    <div className="flex flex-col items-end gap-1">
                      <OrderStatusBadge order={order} />
                      {activeWorkflow && (
                        <span className={`flex items-center gap-1 text-xs font-medium ${activeWorkflow.cardColor}`}>
                          {activeWorkflow.icon}
                          {activeWorkflow.text}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Event Date</p>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        <p className="font-medium text-slate-900">
                          {format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
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

                  {orderSummary && orderSummary.items && orderSummary.items.length > 0 && (
                    <div className="mb-4 pb-4 border-b border-slate-300">
                      <p className="text-sm font-semibold text-slate-700 mb-2">Items:</p>
                      {orderSummary.items.map((item: any, index: number) => (
                        <div key={index} className="flex justify-between text-sm mb-1">
                          <span className="text-slate-600">
                            {item.name} ({item.mode}) × {item.qty}
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatCurrency(item.lineTotal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.subtotal_cents)}
                      </span>
                    </div>
                    {orderSummary
                      ? orderSummary.fees.map((fee, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-slate-600">{fee.name}:</span>
                            <span className="font-semibold text-slate-900">{formatCurrency(fee.amount)}</span>
                          </div>
                        ))
                      : <>
                          {order.travel_fee_cents > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Travel Fee:</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(order.travel_fee_cents)}</span>
                            </div>
                          )}
                          {order.surface_fee_cents > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Surface Fee:</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(order.surface_fee_cents)}</span>
                            </div>
                          )}
                          {order.generator_fee_cents > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Generator:</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(order.generator_fee_cents)}</span>
                            </div>
                          )}
                        </>
                    }
                    {orderSummary && orderSummary.customFees.length > 0 && orderSummary.customFees.map((fee, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-600">{fee.name}:</span>
                        <span className="font-semibold text-slate-900">{formatCurrency(fee.amount)}</span>
                      </div>
                    ))}
                    {orderSummary && orderSummary.discounts.length > 0 && orderSummary.discounts.map((d, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-green-700">{d.name}:</span>
                        <span className="font-semibold text-green-700">-{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
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
                        {formatCurrency(orderSummary ? orderSummary.total : (
                          order.subtotal_cents +
                          order.travel_fee_cents +
                          order.surface_fee_cents +
                          order.same_day_pickup_fee_cents +
                          (order.generator_fee_cents || 0) +
                          order.tax_cents
                        ))}
                      </span>
                    </div>
                    {order.tip_cents > 0 && (
                      <div className="flex justify-between text-sm bg-green-50 p-2 rounded">
                        <span className="text-green-800 font-medium">Crew Tip:</span>
                        <span className="font-semibold text-green-700">
                          {formatCurrency(order.tip_cents)}
                        </span>
                      </div>
                    )}
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
                              window.open(`/receipt/${orderId}/${payment.id}`, '_blank');
                            }}
                            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Printer className="w-4 h-4" />
                            View Receipt
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
                balanceDue={Math.max(0, balanceDue)}
                orderSummary={orderSummary}
                onPaymentComplete={onReload}
                restoredTipCents={restoredTipCents ?? undefined}
              />
            )}

            {activeTab === 'pictures' && <PicturesTab onSubmit={handleSubmitPictures} />}

            {activeTab === 'delivery' && <DeliveryTab orderId={orderId} />}
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
