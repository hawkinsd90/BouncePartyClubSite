import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { X, Navigation, CheckCircle, Camera, MessageCircle, ChevronUp, ChevronDown, Star, AlertTriangle, RefreshCw, RotateCcw, DollarSign, FileCheck, Ban, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { showAlert, showConfirm } from '../common/CustomModal';
import { getCurrentLocation, calculateETA } from '../../lib/googleMaps';

interface Task {
  id: string;
  orderId: string;
  type: 'drop-off' | 'pick-up';
  date: Date;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  items: string[];
  eventStartTime: string;
  eventEndTime: string;
  notes?: string;
  status: string;
  total: number;
  waiverSigned: boolean;
  balanceDue: number;
  pickupPreference?: string;
  payments?: Array<{
    id: string;
    amount_cents: number;
    status: string;
    paid_at: string | null;
    type: string;
  }>;
  taskStatus?: {
    id: string;
    status: string;
    sortOrder: number;
    deliveryImages?: string[];
    damageImages?: string[];
    etaSent: boolean;
  };
}

interface TaskDetailModalProps {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdate: () => void;
}

export function TaskDetailModal({ task, allTasks, onClose, onUpdate }: TaskDetailModalProps) {
  const [processing, setProcessing] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refunding, setRefunding] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [showCashPayment, setShowCashPayment] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [recordingCash, setRecordingCash] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const currentStatus = task.taskStatus?.status || 'pending';
  const navigate = useNavigate();

  useEffect(() => {
    const channel = supabase
      .channel(`order-${task.orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${task.orderId}`,
        },
        () => {
          setLastUpdated(new Date());
          onUpdate();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [task.orderId, onUpdate]);

  async function handleRefresh() {
    setRefreshing(true);
    setLastUpdated(new Date());
    await onUpdate();
    setTimeout(() => setRefreshing(false), 500);
  }

  async function handleRefund() {
    const amountCents = Math.round(parseFloat(refundAmount) * 100);

    if (!amountCents || amountCents <= 0) {
      showAlert('Please enter a valid refund amount');
      return;
    }

    if (!refundReason.trim()) {
      showAlert('Please provide a reason for the refund');
      return;
    }

    const confirmed = await showConfirm(
      `Issue refund of ${formatCurrency(amountCents)} to ${task.customerName}?\n\nReason: ${refundReason}\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setRefunding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-refund`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: task.orderId,
            amountCents,
            reason: refundReason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process refund');
      }

      showAlert(`Refund of ${formatCurrency(amountCents)} processed successfully!`);
      setShowRefundForm(false);
      setRefundAmount('');
      setRefundReason('');
      onUpdate();
    } catch (error: any) {
      console.error('Error processing refund:', error);
      showAlert('Failed to process refund: ' + error.message);
    } finally {
      setRefunding(false);
    }
  }

  const tasksOfSameType = allTasks
    .filter(t => t.type === task.type)
    .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));

  const currentIndex = tasksOfSameType.findIndex(t => t.id === task.id);
  const canMoveUp = currentIndex > 0;
  const canMoveDown = currentIndex < tasksOfSameType.length - 1;

  async function ensureTaskStatus() {
    if (task.taskStatus?.id) {
      return task.taskStatus.id;
    }

    const { data, error } = await supabase
      .from('task_status')
      .insert({
        order_id: task.orderId,
        task_type: task.type,
        task_date: task.date.toISOString().split('T')[0],
        status: 'pending',
        sort_order: tasksOfSameType.length,
      })
      .select()
      .single();

    if (error) throw error;
    return data.id;
  }

  async function handleEnRoute() {
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      let etaMinutes = 30;
      let etaDistance = '';
      let gpsLat = 0;
      let gpsLng = 0;
      let etaCalculationError = null;

      try {
        const crewLocation = await getCurrentLocation();
        gpsLat = crewLocation.lat;
        gpsLng = crewLocation.lng;

        const etaResult = await calculateETA(crewLocation, task.address);
        etaMinutes = etaResult.durationMinutes;
        etaDistance = etaResult.distanceText;

        console.log(`✅ Real ETA calculated: ${etaMinutes} minutes (${etaDistance})`);

        await supabase.from('crew_location_history').insert({
          order_id: task.orderId,
          latitude: crewLocation.lat,
          longitude: crewLocation.lng,
          checkpoint: 'en_route',
        });
      } catch (error: any) {
        console.warn('Could not calculate real ETA, using estimate:', error);
        etaCalculationError = error.message;
      }

      const eta = new Date(Date.now() + etaMinutes * 60000);
      const etaStart = new Date(eta.getTime() - 10 * 60000);
      const etaEnd = new Date(eta.getTime() + 10 * 60000);
      const timeFormat = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      let message = `Hello ${task.customerName.split(' ')[0]}! We're on our way to ${task.type === 'drop-off' ? 'deliver' : 'pick up'} your rental. `;
      message += `ETA: ${timeFormat(etaStart)} - ${timeFormat(etaEnd)}`;
      if (etaDistance) {
        message += ` (${etaDistance} away)`;
      }
      message += '. ';

      if (task.type === 'drop-off') {
        if (!task.waiverSigned || task.balanceDue > 0) {
          message += '\n\n';
          if (!task.waiverSigned) message += '⚠️ IMPORTANT: Your waiver is not signed yet. ';
          if (task.balanceDue > 0) message += `⚠️ IMPORTANT: Balance due: ${formatCurrency(task.balanceDue)}. `;
          message += `\n\nPlease complete these before we arrive: ${window.location.origin}/customer-portal/${task.orderId}`;
        }
        message += '\n\nPlease ensure there is a clear path for delivery and setup. See you soon!';
      }

      const smsResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: task.customerPhone,
            message,
            order_id: task.orderId,
          }),
        }
      );

      if (!smsResponse.ok) throw new Error('Failed to send SMS');

      await supabase
        .from('task_status')
        .update({
          status: 'en_route',
          en_route_time: new Date().toISOString(),
          eta_sent: true,
          waiver_reminder_sent: !task.waiverSigned,
          payment_reminder_sent: task.balanceDue > 0,
          calculated_eta_minutes: etaMinutes,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          eta_calculation_error: etaCalculationError,
        })
        .eq('id', taskStatusId);

      const successMsg = etaCalculationError
        ? `En route notification sent! (Used estimated ETA - ${etaCalculationError})`
        : `En route notification sent with real-time ETA: ${etaMinutes} min (${etaDistance})`;

      showAlert(successMsg);
      onUpdate();
    } catch (error: any) {
      console.error('Error sending en route notification:', error);
      showAlert('Failed to send notification: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleArrived() {
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      let message = `We have arrived at your location! `;

      if (task.type === 'drop-off') {
        if (!task.waiverSigned || task.balanceDue > 0) {
          message += '\n\n⚠️ Before we unload:\n';
          if (!task.waiverSigned) message += '• Please sign the waiver\n';
          if (task.balanceDue > 0) message += `• Complete payment (${formatCurrency(task.balanceDue)})\n`;
          message += `\nComplete at: ${window.location.origin}/customer-portal/${task.orderId}\n\n`;
        }
        message += 'Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location';
      } else {
        message += 'We\'ll begin pickup shortly. Thank you for using Bounce Party Club!';
      }

      const smsResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: task.customerPhone,
            message,
            order_id: task.orderId,
          }),
        }
      );

      if (!smsResponse.ok) throw new Error('Failed to send SMS');

      await supabase
        .from('task_status')
        .update({
          status: 'arrived',
          arrived_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      showAlert('Arrival notification sent successfully!');
      onUpdate();
    } catch (error: any) {
      console.error('Error sending arrival notification:', error);
      showAlert('Failed to send notification: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleImageUpload(isDamage: boolean = false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;

    input.onchange = async (e: any) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setUploadingImages(true);
      try {
        const taskStatusId = await ensureTaskStatus();
        const uploadedUrls: string[] = [];

        for (const file of files) {
          const fileName = `${task.orderId}-${task.type}-${Date.now()}-${file.name}`;
          const { data, error } = await supabase.storage
            .from('public-assets')
            .upload(fileName, file);

          if (error) throw error;

          const { data: urlData } = supabase.storage
            .from('public-assets')
            .getPublicUrl(data.path);

          uploadedUrls.push(urlData.publicUrl);
        }

        const existingTask = await supabase
          .from('task_status')
          .select('delivery_images, damage_images')
          .eq('id', taskStatusId)
          .single();

        const field = isDamage ? 'damage_images' : 'delivery_images';
        const existingImages = (existingTask.data?.[field] as string[]) || [];
        const allImages = [...existingImages, ...uploadedUrls];

        await supabase
          .from('task_status')
          .update({ [field]: allImages })
          .eq('id', taskStatusId);

        showAlert(`${uploadedUrls.length} image(s) uploaded successfully!`);
        onUpdate();
      } catch (error: any) {
        console.error('Error uploading images:', error);
        showAlert('Failed to upload images: ' + error.message);
      } finally {
        setUploadingImages(false);
      }
    };

    input.click();
  }

  async function handleDropOffComplete() {
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      const { data: taskStatusData } = await supabase
        .from('task_status')
        .select('delivery_images')
        .eq('id', taskStatusId)
        .single();

      const deliveryImages = taskStatusData?.delivery_images || [];

      const pickupTime = task.pickupPreference === 'same_day'
        ? `this evening (${task.eventEndTime || 'after your event'})`
        : 'tomorrow morning';

      let message = `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;

      if (deliveryImages.length > 0) {
        message += `\n\n📸 Delivery photos attached (${deliveryImages.length})`;
      }

      const smsResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: task.customerPhone,
            message,
            order_id: task.orderId,
            mediaUrls: deliveryImages,
          }),
        }
      );

      if (!smsResponse.ok) throw new Error('Failed to send SMS');

      await supabase
        .from('task_status')
        .update({
          status: 'completed',
          completed_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      showAlert('Delivery completed and customer notified!');
      onUpdate();
    } catch (error: any) {
      console.error('Error completing delivery:', error);
      showAlert('Failed to complete delivery: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handlePickupComplete() {
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      const message = `Thank you for choosing Bounce Party Club! 🎉\n\nWe hope you had an amazing event! Would you mind leaving us a Google review? It really helps our small business!\n\n⭐ Review us here:\nhttps://g.page/r/YOUR_GOOGLE_BUSINESS_ID/review\n\nWe'd love to serve you again!`;

      const smsResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: task.customerPhone,
            message,
            order_id: task.orderId,
          }),
        }
      );

      if (!smsResponse.ok) throw new Error('Failed to send SMS');

      await supabase
        .from('task_status')
        .update({
          status: 'completed',
          completed_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      showAlert('Pickup completed and thank you message sent!');
      onUpdate();
    } catch (error: any) {
      console.error('Error completing pickup:', error);
      showAlert('Failed to complete pickup: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReorder(direction: 'up' | 'down') {
    try {
      const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      const currentTask = tasksOfSameType[currentIndex];
      const swapTask = tasksOfSameType[swapIndex];

      const currentTaskStatusId = currentTask.taskStatus?.id || await ensureTaskStatus();
      const swapTaskStatusId = swapTask.taskStatus?.id;

      if (!swapTaskStatusId) {
        showAlert('Cannot reorder: other task has no status record');
        return;
      }

      const currentOrder = currentTask.taskStatus?.sortOrder || currentIndex;
      const swapOrder = swapTask.taskStatus?.sortOrder || swapIndex;

      await supabase.from('task_status').update({ sort_order: swapOrder }).eq('id', currentTaskStatusId);
      await supabase.from('task_status').update({ sort_order: currentOrder }).eq('id', swapTaskStatusId);

      onUpdate();
    } catch (error: any) {
      console.error('Error reordering tasks:', error);
      showAlert('Failed to reorder: ' + error.message);
    }
  }

  async function handleCashPayment() {
    const amountCents = Math.round(parseFloat(cashAmount) * 100);

    if (!amountCents || amountCents <= 0) {
      showAlert('Please enter a valid payment amount');
      return;
    }

    const confirmed = await showConfirm(
      `Record cash payment of ${formatCurrency(amountCents)} from ${task.customerName}?\n\nThis will send a receipt email to the customer.`
    );

    if (!confirmed) return;

    setRecordingCash(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          order_id: task.orderId,
          amount_cents: amountCents,
          type: 'balance',
          method: 'cash',
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          created_by: user?.id,
        });

      if (paymentError) throw paymentError;

      const { data: order } = await supabase
        .from('orders')
        .select('*, customers(*)')
        .eq('id', task.orderId)
        .single();

      if (order && order.customers?.email) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: order.customers.email,
            subject: `Payment Received - Order #${task.orderNumber}`,
            text: `Thank you for your payment!\n\nWe have received your cash payment of ${formatCurrency(amountCents)} for order #${task.orderNumber}.\n\nThank you for choosing Bounce Party Club!`,
          }),
        });
      }

      showAlert(`Cash payment of ${formatCurrency(amountCents)} recorded successfully!`);
      setShowCashPayment(false);
      setCashAmount('');
      onUpdate();
    } catch (error: any) {
      console.error('Error recording cash payment:', error);
      showAlert('Failed to record payment: ' + error.message);
    } finally {
      setRecordingCash(false);
    }
  }

  async function handlePaperWaiver() {
    const confirmed = await showConfirm(
      `Mark waiver as signed in person for ${task.customerName}?\n\nThis will update the order to show the waiver has been completed.`
    );

    if (!confirmed) return;

    setSigningWaiver(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      const { error } = await supabase
        .from('order_signatures')
        .insert({
          order_id: task.orderId,
          signature_data: 'PAPER_WAIVER_SIGNED_IN_PERSON',
          signed_at: new Date().toISOString(),
          ip_address: '0.0.0.0',
          user_agent: 'Admin Paper Waiver',
          signed_by: user?.id,
        });

      if (error) throw error;

      showAlert('Waiver marked as signed in person!');
      onUpdate();
    } catch (error: any) {
      console.error('Error marking waiver:', error);
      showAlert('Failed to mark waiver: ' + error.message);
    } finally {
      setSigningWaiver(false);
    }
  }

  async function handleCancelOrder() {
    if (!cancelReason.trim() || cancelReason.trim().length < 10) {
      showAlert('Please provide a cancellation reason (minimum 10 characters)');
      return;
    }

    const confirmed = await showConfirm(
      `Cancel order #${task.orderNumber} for ${task.customerName}?\n\nReason: ${cancelReason}\n\nThis will cancel the order and process any applicable refunds.`
    );

    if (!confirmed) return;

    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-cancel-order`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: task.orderId,
            cancellationReason: cancelReason,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order');
      }

      showAlert(`Order cancelled successfully. ${data.refundMessage}`);
      setShowCancelForm(false);
      setCancelReason('');
      onClose();
      onUpdate();
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      showAlert('Failed to cancel order: ' + error.message);
    } finally {
      setCancelling(false);
    }
  }

  function handleViewOrder() {
    onClose();
    navigate(`/admin?tab=orders&order=${task.orderId}`);
  }

  const isDropOff = task.type === 'drop-off';
  const statusColor = {
    pending: 'bg-slate-100 text-slate-800',
    en_route: 'bg-blue-100 text-blue-800',
    arrived: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
  }[currentStatus];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const taskDate = new Date(task.date);
  taskDate.setHours(0, 0, 0, 0);
  const isToday = taskDate.getTime() === today.getTime();
  const isPast = taskDate.getTime() < today.getTime();
  const isFuture = taskDate.getTime() > today.getTime();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex justify-between items-start z-10">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                {isDropOff ? '🚚 Delivery' : '📦 Pickup'}
              </h2>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusColor}`}>
                {currentStatus.toUpperCase()}
              </span>
            </div>
            <button
              onClick={handleViewOrder}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
            >
              Order #{task.orderNumber}
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <div className="flex gap-2">
                <button
                  onClick={() => handleReorder('up')}
                  disabled={!canMoveUp}
                  className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up in route"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleReorder('down')}
                  disabled={!canMoveDown}
                  className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down in route"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <span className="text-xs text-slate-500">
                Stop #{currentIndex + 1} of {tasksOfSameType.length}
              </span>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">
                  {refreshing ? 'Refreshing...' : `Updated ${Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago`}
                </span>
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {!isToday && (
            <div className={`rounded-lg p-4 border-2 ${isFuture ? 'bg-amber-50 border-amber-400' : 'bg-slate-100 border-slate-400'}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isFuture ? 'text-amber-600' : 'text-slate-600'}`} />
                <div>
                  <h3 className={`font-bold ${isFuture ? 'text-amber-900' : 'text-slate-900'} mb-1`}>
                    {isFuture ? '⚠️ Future Task Warning' : '⚠️ Past Task Warning'}
                  </h3>
                  <p className={`text-sm ${isFuture ? 'text-amber-800' : 'text-slate-700'}`}>
                    {isFuture
                      ? `This task is scheduled for ${task.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, not today. Taking delivery actions now may cause confusion.`
                      : `This task was scheduled for ${task.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} (past date).`
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-4">
            <h3 className="font-bold text-slate-900 mb-3">Customer Information</h3>
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">Name:</span> {task.customerName}</div>
              <div><span className="font-semibold">Phone:</span> {task.customerPhone}</div>
              <div><span className="font-semibold">Address:</span> {task.address}</div>
              <div><span className="font-semibold">Event Time:</span> {task.eventStartTime} - {task.eventEndTime}</div>
              {!task.waiverSigned && (
                <div className="text-amber-700 font-semibold">⚠️ Waiver not signed</div>
              )}
              {task.balanceDue > 0 && (
                <div className="text-red-700 font-semibold">⚠️ Balance due: {formatCurrency(task.balanceDue)}</div>
              )}
              {task.payments && task.payments.filter(p => p.status === 'succeeded').length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-slate-700">💳 Payments Received:</div>
                    <button
                      onClick={() => setShowRefundForm(!showRefundForm)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Refund
                    </button>
                  </div>
                  {task.payments
                    .filter(p => p.status === 'succeeded')
                    .map(payment => (
                      <div key={payment.id} className="text-xs text-green-700 ml-2">
                        ✓ {formatCurrency(payment.amount_cents)} ({payment.type}) - {payment.paid_at ? new Date(payment.paid_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        }) : 'Completed'}
                      </div>
                    ))
                  }

                  {showRefundForm && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Refund Amount ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Reason
                        </label>
                        <input
                          type="text"
                          value={refundReason}
                          onChange={(e) => setRefundReason(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                          placeholder="e.g., Customer request, Weather cancellation"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleRefund}
                          disabled={refunding}
                          className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-xs font-semibold py-1.5 px-3 rounded"
                        >
                          {refunding ? 'Processing...' : 'Issue Refund'}
                        </button>
                        <button
                          onClick={() => setShowRefundForm(false)}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold py-1.5 px-3 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4">
            <h3 className="font-bold text-slate-900 mb-3">Equipment</h3>
            <ul className="space-y-1 text-sm">
              {task.items.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className={isDropOff ? 'text-green-600' : 'text-orange-600'}>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {task.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-bold text-amber-900 mb-2">Special Notes</h3>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-4 space-y-3">
            <h3 className="font-bold text-slate-900 mb-3">Order Management</h3>

            {task.balanceDue > 0 && (
              <div>
                <button
                  onClick={() => setShowCashPayment(!showCashPayment)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <DollarSign className="w-4 h-4" />
                  Record Cash Payment
                </button>
                {showCashPayment && (
                  <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Amount Received ($) - Balance Due: {formatCurrency(task.balanceDue)}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={cashAmount}
                        onChange={(e) => setCashAmount(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                        placeholder={(task.balanceDue / 100).toFixed(2)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCashPayment}
                        disabled={recordingCash}
                        className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                      >
                        {recordingCash ? 'Recording...' : 'Record Payment'}
                      </button>
                      <button
                        onClick={() => setShowCashPayment(false)}
                        className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!task.waiverSigned && (
              <button
                onClick={handlePaperWaiver}
                disabled={signingWaiver}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                <FileCheck className="w-4 h-4" />
                {signingWaiver ? 'Processing...' : 'Mark Waiver Signed (Paper)'}
              </button>
            )}

            <div>
              <button
                onClick={() => setShowCancelForm(!showCancelForm)}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                <Ban className="w-4 h-4" />
                Cancel Order
              </button>
              {showCancelForm && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cancellation Reason (minimum 10 characters)
                    </label>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded"
                      rows={3}
                      placeholder="e.g., Weather cancellation, Customer request, Equipment failure"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancelOrder}
                      disabled={cancelling}
                      className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-sm font-semibold py-2 px-3 rounded"
                    >
                      {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
                    </button>
                    <button
                      onClick={() => setShowCancelForm(false)}
                      className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold py-2 px-3 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h3 className="font-bold text-slate-900 mb-4">Delivery Actions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleEnRoute}
                disabled={processing}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                <Navigation className="w-5 h-5" />
                <span className="text-sm sm:text-base">En Route</span>
              </button>

              <button
                onClick={handleArrived}
                disabled={processing}
                className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                title="Notify customer of arrival"
              >
                <CheckCircle className="w-5 h-5" />
                <span className="text-sm sm:text-base">Arrived</span>
              </button>

              {isDropOff ? (
                <>
                  <button
                    onClick={() => handleImageUpload(false)}
                    disabled={uploadingImages}
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="text-sm sm:text-base">
                      {uploadingImages ? 'Uploading...' : 'Proof Photos'}
                    </span>
                  </button>

                  <button
                    onClick={handleDropOffComplete}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-sm sm:text-base">Leaving - Send Rules</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handlePickupComplete}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                  >
                    <Star className="w-5 h-5" />
                    <span className="text-sm sm:text-base">Complete - Ask Review</span>
                  </button>

                  <button
                    onClick={() => handleImageUpload(true)}
                    disabled={uploadingImages}
                    className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                  >
                    <AlertTriangle className="w-5 h-5" />
                    <span className="text-sm sm:text-base">
                      {uploadingImages ? 'Uploading...' : 'Damage Photos'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>

          {(task.taskStatus?.deliveryImages?.length || task.taskStatus?.damageImages?.length) && (
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-bold text-slate-900 mb-4">Photos</h3>
              {task.taskStatus.deliveryImages && task.taskStatus.deliveryImages.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-sm text-slate-700 mb-2">Delivery Photos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {task.taskStatus.deliveryImages.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`Delivery ${idx + 1}`}
                        className="w-full h-24 object-cover rounded-lg border border-slate-200"
                      />
                    ))}
                  </div>
                </div>
              )}
              {task.taskStatus.damageImages && task.taskStatus.damageImages.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-slate-700 mb-2">Damage Photos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {task.taskStatus.damageImages.map((url, idx) => (
                      <img
                        key={idx}
                        src={url}
                        alt={`Damage ${idx + 1}`}
                        className="w-full h-24 object-cover rounded-lg border border-red-200"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
