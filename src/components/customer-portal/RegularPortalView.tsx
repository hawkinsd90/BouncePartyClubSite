import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { FileText, CreditCard, CheckCircle, Image as ImageIcon, MapPin, Printer, Calendar, MapPin as MapPinIcon, Truck, Navigation, Clock, Package, Lock } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency } from '../../lib/pricing';
import { formatOrderId } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { resolveCustomerPortalTab, buildTabUrlParam, type PortalTabKey, type PortalNavSection } from '../../lib/customerPortalTab';
import WaiverTab from '../waiver/WaiverTab';
import { PaymentTab } from './PaymentTab';
import { PicturesTab } from './PicturesTab';
import { LotPicturesTab } from './LotPicturesTab';
import { CancelOrderModal } from './CancelOrderModal';
import { DeliveryTab } from './DeliveryTab';
import { showToast } from '../../lib/notifications';
import { OrderStatusBadge } from '../dashboard/OrderStatusBadge';
import { ORDER_STATUS, CANCELLABLE_STATUSES } from '../../lib/constants/statuses';

function formatTimeStr(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

interface RegularPortalViewProps {
  order: any;
  orderId: string;
  orderItems: any[];
  orderSummary: any;
  invoiceLinkToken?: string | null;
  onReload: () => void;
  refreshVersion: number;
}

type TabKey = PortalTabKey;

interface NavSection {
  key: TabKey;
  label: string;
  icon: typeof Package;
  status: string;
  locked: boolean;
  lockedReason?: string;
}

export function RegularPortalView({ order, orderId, orderItems: _orderItems, orderSummary, invoiceLinkToken, onReload, refreshVersion }: RegularPortalViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const lotPicturesRequested = order.lot_pictures_requested || false;
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [lotPicturesUploaded, setLotPicturesUploaded] = useState(false);
  const [deliveryPhotosAvailable, setDeliveryPhotosAvailable] = useState(false);
  const [isDelivered, setIsDelivered] = useState(false);
  const [existingPictures, setExistingPictures] = useState<any[]>([]);
  const [restoredTipCents, setRestoredTipCents] = useState<number | null>(null);

  const loadPayments = useCallback(async () => {
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
      setPayments([]);
    }
  }, [orderId]);

  const loadLotPictures = useCallback(async () => {
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
      setLotPicturesUploaded(false);
    }
  }, [orderId]);

  const loadDeliveryStatus = useCallback(async () => {
    try {
      const { data: rows, error } = await supabase
        .from('task_status')
        .select('delivery_images, status')
        .eq('order_id', orderId)
        .eq('task_type', 'drop-off')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = rows && rows.length > 0 ? rows[0] : null;
      if (row) {
        const imgs: string[] = Array.isArray(row.delivery_images) ? row.delivery_images : [];
        setDeliveryPhotosAvailable(imgs.length > 0);
        setIsDelivered(row.status === 'completed');
      } else {
        setDeliveryPhotosAvailable(false);
        setIsDelivered(false);
      }
    } catch (err) {
      console.error('Error loading delivery status:', err);
      setDeliveryPhotosAvailable(false);
      setIsDelivered(false);
    }
  }, [orderId]);

  const loadExistingPictures = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('order_pictures' as any)
        .select('id, file_path, file_name, notes, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const withUrls = (data || []).map((pic: any) => {
        const { data: urlData } = supabase.storage
          .from('order-pictures')
          .getPublicUrl(pic.file_path);
        return { ...pic, url: urlData.publicUrl };
      });
      setExistingPictures(withUrls);
    } catch (err) {
      console.error('Error loading existing pictures:', err);
      setExistingPictures([]);
    }
  }, [orderId]);

  useEffect(() => {
    const results = Promise.allSettled([
      loadPayments(),
      loadLotPictures(),
      loadDeliveryStatus(),
      loadExistingPictures(),
    ]);
    void results;
  }, [orderId, refreshVersion, loadPayments, loadLotPictures, loadDeliveryStatus, loadExistingPictures]);

  // On mount, read payment-status params and tip restoration.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const tabParam = params.get('tab');
    const tipParam = params.get('tip');
    const cardUpdated = params.get('card_updated') === 'true';

    if (tabParam === 'payment') {
      if (tipParam) {
        const parsed = parseInt(tipParam, 10);
        if (!isNaN(parsed) && parsed > 0) setRestoredTipCents(parsed);
      }
      // Clean payment/card params but preserve tab=payment (replace)
      const next = new URLSearchParams(window.location.search);
      next.delete('payment');
      next.delete('card_updated');
      next.delete('tip');
      setSearchParams(next, { replace: true });
    } else if (cardUpdated) {
      if (tipParam) {
        const parsed = parseInt(tipParam, 10);
        if (!isNaN(parsed) && parsed > 0) setRestoredTipCents(parsed);
      }
      // Set tab=payment and clean card params (replace)
      const next = new URLSearchParams(window.location.search);
      next.set('tab', 'payment');
      next.delete('card_updated');
      next.delete('tip');
      setSearchParams(next, { replace: true });
    } else if (paymentStatus === 'success') {
      showToast('Payment successful! Thank you.', 'success');
      const next = new URLSearchParams(window.location.search);
      next.delete('payment');
      setSearchParams(next, { replace: true });
    } else if (paymentStatus === 'canceled') {
      showToast('Payment was canceled. You can try again anytime.', 'info');
      const next = new URLSearchParams(window.location.search);
      next.delete('payment');
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmitPictures(files: File[], notes: string) {
    try {
      const uploadPromises = files.map(async (file) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${orderId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('order-pictures')
          .upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
        const { error: dbError } = await supabase
          .from('order_pictures' as any)
          .insert({
            order_id: orderId,
            file_path: fileName,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            notes: notes || null,
            uploaded_by: null,
          });
        if (dbError) throw dbError;
        return fileName;
      });
      await Promise.all(uploadPromises);
      showToast(`Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`, 'success');
      loadExistingPictures();
    } catch (error) {
      console.error('Error submitting pictures:', error);
      showToast('Failed to upload pictures. Please try again.', 'error');
      throw error;
    }
  }

  const totalPaid = (order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0);
  const balanceDue = order.balance_due_cents;
  const needsWaiver = !order.waiver_signed_at;
  const needsPayment = balanceDue > 0;
  const canCancel = (CANCELLABLE_STATUSES as readonly string[]).includes(order.status);
  const isActiveOrder = [
    ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED,
  ].includes(order.status as any);
  const stepsUnlocked = totalPaid > 0 || isActiveOrder;
  const orderDelivered = ([ORDER_STATUS.COMPLETED, ORDER_STATUS.IN_PROGRESS] as string[]).includes(order.status) &&
    ['setup_completed', 'pickup_scheduled', 'pickup_in_progress'].includes(order.workflow_status || '')
    || order.status === ORDER_STATUS.COMPLETED;

  const successfulPayments = payments.filter(p => p.status === 'succeeded');

  const workflowLabels: Record<string, { text: string; icon: React.ReactNode; headerColor: string; cardColor: string }> = {
    on_the_way:         { text: 'Crew is on the way',       icon: <Navigation className="w-3.5 h-3.5" />, headerColor: 'text-white font-semibold', cardColor: 'text-blue-700' },
    arrived:            { text: 'Crew has arrived',          icon: <Clock className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-yellow-700' },
    setup_in_progress:  { text: 'Setup in progress',         icon: <Truck className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-cyan-700' },
    setup_completed:    { text: 'Equipment delivered',       icon: <Truck className="w-3.5 h-3.5" />,      headerColor: 'text-white font-semibold', cardColor: 'text-green-700' },
    pickup_scheduled:   { text: 'Pickup scheduled',          icon: <Package className="w-3.5 h-3.5" />,    headerColor: 'text-white font-semibold', cardColor: 'text-amber-700' },
    pickup_in_progress: { text: 'Crew picking up equipment', icon: <Navigation className="w-3.5 h-3.5" />, headerColor: 'text-white font-semibold', cardColor: 'text-orange-700' },
  };
  const activeWorkflow = order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status
    ? workflowLabels[order.workflow_status]
    : null;

  const sections: NavSection[] = [
    {
      key: 'details',
      label: 'Details',
      icon: Package,
      status: 'Available',
      locked: false,
    },
  ];

  // Lot Pics is always available as a distinct section (pre-event location photos).
  // It is separate from the Pictures tab (delivery/proof photos).
  sections.push({
    key: 'lot-pics',
    label: 'Lot Pics',
    icon: MapPin,
    status: lotPicturesUploaded ? 'Complete' : lotPicturesRequested ? 'Required' : 'Optional',
    locked: false,
  });

  sections.push({
    key: 'waiver',
    label: 'Waiver',
    icon: FileText,
    status: !stepsUnlocked ? 'Locked' : needsWaiver ? 'Required' : 'Complete',
    locked: !stepsUnlocked,
    lockedReason: !stepsUnlocked ? 'Available after payment' : undefined,
  });

  sections.push({
    key: 'payment',
    label: 'Payment',
    icon: CreditCard,
    status: !stepsUnlocked ? 'Locked' : needsPayment ? `${formatCurrency(balanceDue)} due` : 'Complete',
    locked: !stepsUnlocked,
    lockedReason: !stepsUnlocked ? 'Available after deposit' : undefined,
  });

  const picturesAvailable = isDelivered || orderDelivered;
  sections.push({
    key: 'pictures',
    label: 'Pictures',
    icon: ImageIcon,
    status: picturesAvailable ? 'Optional' : 'Available after delivery',
    locked: !picturesAvailable,
    lockedReason: !picturesAvailable ? 'Available after equipment is delivered' : undefined,
  });

  sections.push({
    key: 'delivery',
    label: 'Delivery',
    icon: Truck,
    status: deliveryPhotosAvailable ? 'Available' : 'Available after setup',
    locked: !deliveryPhotosAvailable,
    lockedReason: !deliveryPhotosAvailable ? 'Delivery photos appear here after crew completes setup' : undefined,
  });

  // URL is the single source of truth for the active tab.
  const activeTab = resolveCustomerPortalTab({
    requestedTab: searchParams.get('tab'),
    sections: sections as PortalNavSection[],
  });

  // If the URL tab is locked/invalid, resolveCustomerPortalTab returns 'details'.
  // If the URL says something else but the resolved tab is 'details', update the URL.
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    const expectedParam = buildTabUrlParam(activeTab);
    if (urlTab !== expectedParam) {
      const next = new URLSearchParams(searchParams);
      if (expectedParam === null) {
        next.delete('tab');
      } else {
        next.set('tab', expectedParam);
      }
      setSearchParams(next, { replace: true });
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle tab click — push to URL history (not replace).
  function handleTabSelect(tab: TabKey) {
    const next = new URLSearchParams(searchParams);
    const paramValue = buildTabUrlParam(tab);
    if (paramValue === null) {
      next.delete('tab');
    } else {
      next.set('tab', paramValue);
    }
    setSearchParams(next);
  }

  function getSectionStyles(section: NavSection, isActive: boolean): string {
    const base = 'flex flex-col items-center justify-center gap-1.5 rounded-xl p-3 min-h-[56px] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';
    if (section.locked) {
      return `${base} bg-slate-50 text-slate-400 cursor-not-allowed aria-disabled:border-2 aria-disabled:border-slate-200`;
    }
    if (isActive) {
      return `${base} bg-blue-600 text-white shadow-md shadow-blue-600/20`;
    }
    if (section.status === 'Required') {
      return `${base} bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300`;
    }
    if (section.status === 'Complete') {
      return `${base} bg-green-50 text-green-800 hover:bg-green-100 border border-green-300`;
    }
    return `${base} bg-slate-100 text-slate-700 hover:bg-slate-200`;
  }

  function getSectionIcon(section: NavSection) {
    const Icon = section.icon;
    if (section.locked) return <Lock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />;
    if (section.status === 'Complete') return <CheckCircle className="w-4 h-4 flex-shrink-0 text-green-500" aria-hidden="true" />;
    return <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />;
  }

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
                    Event Date: {format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}
                    {order.start_window && (<> at {formatTimeStr(order.start_window)}</>)}
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

          <div className="px-4 sm:px-8 py-6">
            <nav aria-label="Portal sections" className="mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                {sections.map((section) => {
                  const isActive = activeTab === section.key;
                  return (
                    <button
                      key={section.key}
                      onClick={() => !section.locked && handleTabSelect(section.key)}
                      disabled={section.locked}
                      aria-current={isActive ? 'page' : undefined}
                      aria-disabled={section.locked}
                      aria-label={`${section.label} — ${section.status}${section.lockedReason ? `, ${section.lockedReason}` : ''}`}
                      className={getSectionStyles(section, isActive)}
                    >
                      <div className="flex items-center gap-2">
                        {getSectionIcon(section)}
                        <span className="text-sm font-semibold">{section.label}</span>
                      </div>
                      <span className="text-xs font-medium opacity-90">{section.status}</span>
                      {section.locked && section.lockedReason && (
                        <span className="text-[10px] leading-tight opacity-75 text-center">{section.lockedReason}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>

            {activeTab === 'details' && (
              <div className="space-y-6">
                {totalPaid === 0 && order.status === ORDER_STATUS.PENDING && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 font-medium">Order Pending Approval</p>
                    <p className="text-sm text-amber-700 mt-1">
                      Your order is pending approval. Payment will be required once approved.
                    </p>
                  </div>
                )}

                {order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status === 'on_the_way' && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 flex items-start gap-3">
                    <Navigation className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-900">Crew is on the way!</p>
                      <p className="text-sm text-blue-700 mt-1">Your equipment is en route. The crew will arrive shortly.</p>
                    </div>
                  </div>
                )}

                {order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status === 'arrived' && (
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3">
                    <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-yellow-900">Crew has arrived</p>
                      <p className="text-sm text-yellow-700 mt-1">The crew is at your location setting up the equipment.</p>
                    </div>
                  </div>
                )}

                {order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status === 'setup_completed' && (
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

                {order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status === 'pickup_in_progress' && (
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
                      <p className="font-medium text-slate-900">{formatTimeStr(order.start_window)}</p>
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
                        <div key={index}>
                          {(item as any).packageContentsUnavailable && (
                            <div className="mb-1 pl-3">
                              <p className="text-xs text-slate-400 italic">Package contents unavailable</p>
                            </div>
                          )}
                          {(item as any).components && (item as any).components.length > 0 && (
                            <div className="mb-1 pl-3">
                              <p className="text-xs text-slate-500 mb-0.5">Included in {item.name}:</p>
                              {(item as any).components.map((c: { name: string; quantity: number }, ci: number) => (
                                <div key={ci} className="text-xs text-slate-500">
                                  - {c.name} × {c.quantity}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-600">{item.name} ({item.mode}) × {item.qty}</span>
                            <span className="font-medium text-slate-900">{formatCurrency(item.lineTotal)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal:</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(order.subtotal_cents)}</span>
                    </div>
                    {orderSummary
                      ? orderSummary.fees.map((fee: any, i: number) => (
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
                    {orderSummary && orderSummary.customFees.length > 0 && orderSummary.customFees.map((fee: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-600">{fee.name}:</span>
                        <span className="font-semibold text-slate-900">{formatCurrency(fee.amount)}</span>
                      </div>
                    ))}
                    {orderSummary && orderSummary.discounts.length > 0 && orderSummary.discounts.map((d: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-green-700">{d.name}:</span>
                        <span className="font-semibold text-green-700">-{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
                    {order.tax_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Tax:</span>
                        <span className="font-semibold text-slate-900">{formatCurrency(order.tax_cents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-300">
                      <span className="font-semibold text-slate-900">Total:</span>
                      <span className="text-lg font-bold text-slate-900">
                        {formatCurrency(orderSummary ? orderSummary.total : (order.total_cents || 0))}
                      </span>
                    </div>
                    {order.tip_cents > 0 && (
                      <div className="flex justify-between text-sm bg-green-50 p-2 rounded">
                        <span className="text-green-800 font-medium">Crew Tip:</span>
                        <span className="font-semibold text-green-700">{formatCurrency(order.tip_cents)}</span>
                      </div>
                    )}
                    {totalPaid > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Already Paid:</span>
                          <span className="font-semibold text-green-700">{formatCurrency(totalPaid)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-slate-300">
                          <span className="font-semibold text-slate-900">Balance Due:</span>
                          <span className="text-xl font-bold text-blue-600">{formatCurrency(balanceDue)}</span>
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
                        <div key={payment.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg p-4">
                          <div>
                            <p className="font-medium text-slate-900">{formatCurrency(payment.amount_cents)}</p>
                            <p className="text-xs text-slate-600">{format(new Date(payment.created_at), 'MMM d, yyyy h:mm a')}</p>
                            <p className="text-xs text-slate-500">{payment.payment_method === 'card' ? 'Credit Card' : payment.payment_method}</p>
                          </div>
                          <button
                            onClick={() => window.open(`/receipt/${orderId}/${payment.id}`, '_blank')}
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

            {activeTab === 'lot-pics' && (
              <LotPicturesTab
                orderId={orderId}
                orderNumber={order.order_number}
                orderStatus={order.status}
                onUploadComplete={() => { loadLotPictures(); onReload(); }}
              />
            )}

            {activeTab === 'waiver' && <WaiverTab orderId={orderId} order={order} token={invoiceLinkToken ?? undefined} />}

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

            {activeTab === 'pictures' && <PicturesTab onSubmit={handleSubmitPictures} existingPictures={existingPictures} />}

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
          customerEmail={order.customers?.email ?? ''}
          invoiceLinkToken={invoiceLinkToken}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => { onReload(); showToast('Your order has been cancelled', 'success'); }}
        />
      )}
    </div>
  );
}
