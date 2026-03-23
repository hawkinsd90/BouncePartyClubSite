import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { X, ChevronUp, ChevronDown, AlertTriangle, RefreshCw, ExternalLink, ArrowLeft } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { showAlert, showConfirm } from '../common/CustomModal';
import { getCurrentLocation, calculateETA } from '../../lib/googleMaps';
import { Task } from '../../hooks/useCalendarTasks';
import { TaskDetailCustomerInfo } from './task-detail/TaskDetailCustomerInfo';
import { TaskDetailOrderManagement } from './task-detail/TaskDetailOrderManagement';
import { TaskDetailActions } from './task-detail/TaskDetailActions';

export type { Task };

interface TaskDetailModalProps {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdate: () => void;
  onRefresh?: () => void;
  onBack?: () => void;
  onOpenMileageModal?: () => void;
}

export function TaskDetailModal({ task, allTasks, onClose, onUpdate, onRefresh, onBack, onOpenMileageModal }: TaskDetailModalProps) {
  const refresh = onRefresh || onUpdate;
  const [processing, setProcessing] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refunding, setRefunding] = useState(false);
  const [recordingCash, setRecordingCash] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mileageLog, setMileageLog] = useState<any>(null);
  const currentStatus = task.taskStatus?.status || 'pending';
  const navigate = useNavigate();

  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { setLastUpdated(new Date()); refresh(); }, 300);
    };
    const channel = supabase
      .channel(`order-${task.orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${task.orderId}` }, debouncedUpdate)
      .subscribe();
    return () => { if (debounceTimer) clearTimeout(debounceTimer); supabase.removeChannel(channel); };
  }, [task.orderId, refresh]);

  useEffect(() => {
    async function loadMileageLog() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const dateStr = task.date.toISOString().split('T')[0];
        const { data } = await supabase
          .from('daily_mileage_logs').select('*')
          .eq('date', dateStr).eq('user_id', user.id).maybeSingle();
        setMileageLog(data);
      } catch (error) { console.error('Error loading mileage log:', error); }
    }
    loadMileageLog();
  }, [task.date]);

  const tasksOfSameType = allTasks
    .filter(t => t.type === task.type)
    .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));
  const currentIndex = tasksOfSameType.findIndex(t => t.id === task.id);
  const canMoveUp = currentIndex > 0;
  const canMoveDown = currentIndex < tasksOfSameType.length - 1;

  async function ensureTaskStatus() {
    if (task.taskStatus?.id) return task.taskStatus.id;
    const { data, error } = await supabase
      .from('task_status')
      .insert({ order_id: task.orderId, task_type: task.type, task_date: task.date.toISOString().split('T')[0], status: 'pending', notes: null })
      .select().single();
    if (error) throw error;
    return data.id;
  }

  async function handleEnRoute() {
    const confirmed = await showConfirm(
      `Mark this ${task.type === 'drop-off' ? 'delivery' : 'pickup'} as En Route for ${task.customerName}?\n\nThis will notify the customer with an ETA.`
    );
    if (!confirmed) return;

    if (!mileageLog || !mileageLog.start_mileage) {
      const ok = await showConfirm('Starting mileage required before marking tasks as En Route.\n\nWould you like to record your starting mileage now?');
      if (ok) {
        if (onOpenMileageModal) onOpenMileageModal();
        else showAlert('Please use the "Start Day Mileage" button at the top of the day view to record your starting mileage, then return here to mark this task as En Route.');
      }
      return;
    }

    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();
      let etaMinutes = 30, etaDistance = '', gpsLat = 0, gpsLng = 0, etaCalcErr: string | null = null;
      try {
        const loc = await getCurrentLocation();
        gpsLat = loc.lat; gpsLng = loc.lng;
        const eta = await calculateETA(loc, task.address);
        etaMinutes = eta.durationMinutes; etaDistance = eta.distanceText;
        const { error: locErr } = await supabase.from('crew_location_history').insert({ latitude: loc.lat, longitude: loc.lng, order_id: task.orderId });
        if (locErr) console.warn('crew_location_history insert failed:', locErr.message);
      } catch (e: any) { console.warn('ETA calc failed:', e); etaCalcErr = e.message; }

      const eta = new Date(Date.now() + etaMinutes * 60000);
      const etaStart = new Date(eta.getTime() - 10 * 60000);
      const etaEnd = new Date(eta.getTime() + 10 * 60000);
      const tf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      let msg = `Hello ${task.customerName.split(' ')[0]}! We're on our way to ${task.type === 'drop-off' ? 'deliver' : 'pick up'} your rental. ETA: ${tf(etaStart)} - ${tf(etaEnd)}`;
      if (etaDistance) msg += ` (${etaDistance} away)`;
      msg += '. ';
      if (task.type === 'drop-off') {
        if (!task.waiverSigned || task.balanceDue > 0) {
          msg += '\n\n';
          if (!task.waiverSigned) msg += '⚠️ IMPORTANT: Your waiver is not signed yet. ';
          if (task.balanceDue > 0) msg += `⚠️ IMPORTANT: Balance due: ${formatCurrency(task.balanceDue)}. `;
          msg += `\n\nPlease complete these before we arrive: ${window.location.origin}/customer-portal/${task.orderId}`;
        }
        msg += '\n\nPlease ensure there is a clear path for delivery and setup. See you soon!';
      }

      let smsWarning: string | null = null;
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: task.customerPhone, message: msg, order_id: task.orderId }),
        });
        if (!r.ok) { smsWarning = 'SMS failed to send'; console.warn('En Route SMS failed:', await r.text()); }
      } catch (e: any) { smsWarning = 'SMS failed: ' + e.message; }

      const { error: taskErr } = await supabase.from('task_status').update({
        status: 'en_route', en_route_time: new Date().toISOString(),
        eta_sent: smsWarning === null, waiver_reminder_sent: !task.waiverSigned,
        payment_reminder_sent: task.balanceDue > 0, calculated_eta_minutes: etaMinutes,
        gps_lat: gpsLat, gps_lng: gpsLng, eta_calculation_error: etaCalcErr,
      }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const workflowValue = task.type === 'drop-off' ? 'on_the_way' : 'pickup_in_progress';
      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: workflowValue }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (en route):', wfErr.message);

      let successMsg = smsWarning && etaCalcErr ? `En Route saved (fallback ETA). Warning: ${smsWarning}.`
        : smsWarning ? `En Route saved. Warning: ${smsWarning}.`
        : etaCalcErr ? `En Route saved and customer notified (fallback ETA used).`
        : `En Route saved and customer notified. ETA: ${etaMinutes} min${etaDistance ? ` (${etaDistance})` : ''}.`;
      if (wfErr) successMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
      showAlert(successMsg);
      refresh();
    } catch (e: any) { console.error('Error en route:', e); showAlert('Failed to send notification: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handleArrived() {
    const confirmed = await showConfirm(`Mark as Arrived at ${task.customerName}'s location?\n\nThis will notify the customer that the crew has arrived.`);
    if (!confirmed) return;
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before marking tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();
      let msg = `We have arrived at your location! `;
      if (task.type === 'drop-off') {
        if (!task.waiverSigned || task.balanceDue > 0) {
          msg += '\n\n⚠️ Before we unload:\n';
          if (!task.waiverSigned) msg += '• Please sign the waiver\n';
          if (task.balanceDue > 0) msg += `• Complete payment (${formatCurrency(task.balanceDue)})\n`;
          msg += `\nComplete at: ${window.location.origin}/customer-portal/${task.orderId}\n\n`;
        }
        msg += 'Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location';
      } else {
        msg += "We'll begin pickup shortly. Thank you for using Bounce Party Club!";
      }

      let smsWarn: string | null = null;
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: task.customerPhone, message: msg, order_id: task.orderId }),
        });
        if (!r.ok) { smsWarn = 'SMS failed to send'; console.warn('Arrived SMS failed:', await r.text()); }
      } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; }

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'arrived', arrived_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'arrived' }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (arrived):', wfErr.message);

      let arrivedMsg = smsWarn ? `Arrived saved. Warning: ${smsWarn}.` : 'Arrived and customer notified successfully!';
      if (wfErr) arrivedMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
      showAlert(arrivedMsg);
      refresh();
    } catch (e: any) { console.error('Error arrived:', e); showAlert('Failed to send notification: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handleImageUpload(isDamage?: boolean) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = async (e: any) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setUploadingImages(true);
      try {
        const taskStatusId = await ensureTaskStatus();
        const uploadedUrls: string[] = [];
        for (const file of files) {
          const fileName = `${task.orderId}-${task.type}-${Date.now()}-${file.name}`;
          const { data, error } = await supabase.storage.from('public-assets').upload(fileName, file);
          if (error) throw error;
          const { data: urlData } = supabase.storage.from('public-assets').getPublicUrl(data.path);
          uploadedUrls.push(urlData.publicUrl);
        }
        const col = isDamage ? 'damage_images' : 'delivery_images';
        const { data: cur, error: fetchErr } = await supabase.from('task_status').select(col).eq('id', taskStatusId).maybeSingle();
        if (fetchErr) throw fetchErr;
        const merged = [...((cur as any)?.[col] || []), ...uploadedUrls];
        const { error: updErr } = await supabase.from('task_status').update({ [col]: merged }).eq('id', taskStatusId);
        if (updErr) throw updErr;
        showAlert(`${uploadedUrls.length} ${isDamage ? 'damage' : 'delivery'} photo(s) uploaded and saved successfully!`);
        refresh();
      } catch (e: any) { console.error('Upload error:', e); showAlert('Failed to upload images: ' + e.message); }
      finally { setUploadingImages(false); }
    };
    input.click();
  }

  async function handleDropOffComplete() {
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }
    const hasPhotos = (task.taskStatus?.deliveryImages?.length ?? 0) > 0;
    const confirmed = await showConfirm(
      hasPhotos
        ? `Mark delivery as complete and send rules to ${task.customerName}?\n\nThis will send the equipment rules SMS and notify the customer.`
        : `Mark delivery as complete and send rules to ${task.customerName}?\n\n⚠️ WARNING: No delivery photos have been taken yet.\n\nYou can still proceed, but it is strongly recommended to take proof photos first.\n\nProceed without photos?`
    );
    if (!confirmed) return;
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();
      const pickupTime = task.pickupPreference === 'same_day' ? `this evening (${task.eventEndTime || 'after your event'})` : 'tomorrow morning';
      const msg = `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;

      let smsWarn: string | null = null;
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: task.customerPhone, message: msg, order_id: task.orderId, mediaUrls: [] }),
        });
        if (!r.ok) { smsWarn = 'SMS failed to send'; console.warn('Drop-off SMS failed:', await r.text()); }
      } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; }

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'completed', completed_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'setup_completed' }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (setup_completed):', wfErr.message);

      let dropOffMsg = smsWarn ? `Delivery marked complete. Warning: ${smsWarn}.` : 'Delivery completed and customer notified!';
      if (wfErr) dropOffMsg += '\n\n⚠️ Portal will not show "Delivered" — workflow state failed to save.';
      showAlert(dropOffMsg);
      refresh();
    } catch (e: any) { console.error('Drop-off complete error:', e); showAlert('Failed to complete delivery: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handlePickupComplete() {
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      let smsWarn: string | null = null;
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateKey: 'pickup_thanks_sms', orderId: task.orderId }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); smsWarn = d.error || 'SMS failed to send'; }
      } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; }

      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateName: 'pickup_complete', orderId: task.orderId }),
        });
        if (!r.ok) console.warn('Pickup complete email failed (non-blocking)');
      } catch (e: any) { console.warn('Pickup email error (non-blocking):', e); }

      // workflow_status MUST be written before task_status so the DB trigger
      // reads 'pickup_in_progress' when it fires and advances orders.status → completed.
      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'pickup_in_progress' }).eq('id', task.orderId);
      if (wfErr) throw new Error('Failed to set pickup workflow status: ' + wfErr.message);

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'completed', completed_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      showAlert(smsWarn ? `Pickup marked complete. Warning: ${smsWarn}.` : 'Pickup completed! Thank you message and review request sent.');
      refresh();
    } catch (e: any) { console.error('Pickup complete error:', e); showAlert('Failed to complete pickup: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handleReorder(direction: 'up' | 'down') {
    try {
      const idx = tasksOfSameType.findIndex(t => t.id === task.id);
      if (idx === -1) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= tasksOfSameType.length) return;
      const cur = tasksOfSameType[idx]; const swap = tasksOfSameType[swapIdx];
      const curOrder = cur.taskStatus?.sortOrder || idx; const swapOrder = swap.taskStatus?.sortOrder || swapIdx;
      const updates: Promise<{ error: any }>[] = [];
      if (cur.taskStatus?.id) updates.push(supabase.from('task_status').update({ sort_order: swapOrder }).eq('id', cur.taskStatus.id));
      if (swap.taskStatus?.id) updates.push(supabase.from('task_status').update({ sort_order: curOrder }).eq('id', swap.taskStatus.id));
      const results = await Promise.all(updates);
      const err = results.find(r => r.error)?.error;
      if (err) throw new Error('Failed to reorder: ' + err.message);
      showAlert(`Task moved ${direction}`);
      refresh();
    } catch (e: any) { console.error('Reorder error:', e); showAlert('Failed to reorder: ' + e.message); }
  }

  async function handleRefund(amountCents: number, reason: string) {
    const confirmed = await showConfirm(`Issue refund of ${formatCurrency(amountCents)} to ${task.customerName}?\n\nReason: ${reason}\n\nThis action cannot be undone.`);
    if (!confirmed) return;
    setRefunding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-refund`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, amountCents, reason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to process refund');
      showAlert(`Refund of ${formatCurrency(amountCents)} processed successfully!`);
      onUpdate();
    } catch (e: any) { console.error('Refund error:', e); showAlert('Failed to process refund: ' + e.message); }
    finally { setRefunding(false); }
  }

  async function handleCashPayment(amountCents: number) {
    const confirmed = await showConfirm(`Record cash payment of ${formatCurrency(amountCents)} from ${task.customerName}?\n\nThis will send a receipt email to the customer.`);
    if (!confirmed) return;
    setRecordingCash(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-cash-payment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, amountCents }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to record payment');
      showAlert(`Cash payment of ${formatCurrency(amountCents)} recorded successfully!`);
      refresh();
    } catch (e: any) { console.error('Cash payment error:', e); showAlert('Failed to record payment: ' + e.message); }
    finally { setRecordingCash(false); }
  }

  async function handlePaperWaiver() {
    const confirmed = await showConfirm(`Mark waiver as signed in person for ${task.customerName}?\n\nThis will update the order to show the waiver has been completed.`);
    if (!confirmed) return;
    setSigningWaiver(true);
    try {
      const { error } = await supabase.from('order_signatures').insert({
        order_id: task.orderId, signature_data_url: 'PAPER_WAIVER_SIGNED_IN_PERSON',
        renter_name: task.customerName || 'Unknown', renter_phone: task.customerPhone || '',
        renter_email: task.customerEmail || null, ip_address: '0.0.0.0', user_agent: 'Admin Paper Waiver',
      });
      if (error) throw error;
      showAlert('Waiver marked as signed in person!');
      refresh();
    } catch (e: any) { console.error('Paper waiver error:', e); showAlert('Failed to mark waiver: ' + e.message); }
    finally { setSigningWaiver(false); }
  }

  async function handleCancelOrder(cancelReason: string) {
    if (!cancelReason.trim() || cancelReason.trim().length < 10) {
      showAlert('Please provide a cancellation reason (minimum 10 characters)');
      return;
    }
    const shouldRefund = await showConfirm(`Would you like to issue a full refund to ${task.customerName}?\n\nClick OK to issue refund, or Cancel to skip refund.`);
    const finalConfirm = await showConfirm(`Cancel order #${task.orderNumber} for ${task.customerName}?\n\nReason: ${cancelReason}\n${shouldRefund ? '\n✓ Full refund will be issued' : '\n✗ No refund will be issued'}\n\nCustomer will be notified via SMS.`);
    if (!finalConfirm) return;
    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-cancel-order`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, cancellationReason: cancelReason, adminOverrideRefund: shouldRefund }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to cancel order');
      showAlert(`Order cancelled successfully. ${data.refundMessage}`);
      onClose(); onUpdate();
    } catch (e: any) { console.error('Cancel order error:', e); showAlert('Failed to cancel order: ' + e.message); }
    finally { setCancelling(false); }
  }

  const isDropOff = task.type === 'drop-off';
  const statusColor = ({ pending: 'bg-slate-100 text-slate-800', en_route: 'bg-blue-100 text-blue-800', arrived: 'bg-yellow-100 text-yellow-800', completed: 'bg-green-100 text-green-800' } as Record<string, string>)[currentStatus] || 'bg-slate-100 text-slate-800';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const taskDate = new Date(task.date); taskDate.setHours(0, 0, 0, 0);
  const isToday = taskDate.getTime() === today.getTime();
  const isFuture = taskDate.getTime() > today.getTime();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-2 sm:my-4 mx-2 sm:mx-4 max-h-[calc(100vh-16px)] sm:max-h-[95vh] overflow-y-auto flex flex-col">

        {/* Sticky header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 z-10 flex-shrink-0">
          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-sm mb-3 -ml-1 px-1 py-1 hover:bg-blue-50 rounded-lg transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span>Back to day view</span>
            </button>
          )}
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h2 className="text-lg sm:text-2xl font-bold text-slate-900">
                  {isDropOff ? 'Delivery' : 'Pickup'}
                </h2>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusColor}`}>
                  {currentStatus.toUpperCase()}
                </span>
              </div>
              <button onClick={() => { onClose(); navigate(`/admin?tab=orders&subtab=single_order&orderId=${task.orderId}`); }} className="text-sm text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1">
                Order #{task.orderNumber}
                <ExternalLink className="w-3 h-3" />
              </button>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <div className="flex gap-2">
                  <button onClick={() => handleReorder('up')} disabled={!canMoveUp} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Move up in route"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => handleReorder('down')} disabled={!canMoveDown} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Move down in route"><ChevronDown className="w-4 h-4" /></button>
                </div>
                <span className="text-xs text-slate-500">Stop #{currentIndex + 1} of {tasksOfSameType.length}</span>
                <button onClick={async () => { setRefreshing(true); setLastUpdated(new Date()); await refresh(); setTimeout(() => setRefreshing(false), 500); }} disabled={refreshing} className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : `Updated ${Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago`}</span>
                </button>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"><X className="w-6 h-6" /></button>
          </div>
        </div>

        {/* Mobile action bar */}
        {isToday && currentStatus !== 'completed' && (
          <div className="sm:hidden sticky top-[60px] bg-white border-b border-slate-200 px-4 py-3 z-10 flex-shrink-0">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleEnRoute} disabled={processing} className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">En Route</button>
              <button onClick={handleArrived} disabled={processing} className="flex items-center justify-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Arrived</button>
              {isDropOff ? (
                <>
                  <button onClick={() => handleImageUpload(false)} disabled={uploadingImages} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Photos</button>
                  <button onClick={handleDropOffComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm">Leaving</button>
                </>
              ) : (
                <button onClick={handlePickupComplete} disabled={processing} className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-3 rounded-lg transition-colors text-sm col-span-2">Complete Pickup</button>
              )}
            </div>
          </div>
        )}

        <div className="p-4 sm:p-6 space-y-6">
          {/* Date warning */}
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
                      : `This task was scheduled for ${task.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} (past date).`}
                  </p>
                </div>
              </div>
            </div>
          )}

          <TaskDetailCustomerInfo task={task} onRefund={handleRefund} refunding={refunding} />

          {/* Equipment */}
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

          {/* Notes */}
          {task.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-bold text-amber-900 mb-2">Special Notes</h3>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          <TaskDetailOrderManagement
            task={task}
            onCashPayment={handleCashPayment}
            onPaperWaiver={handlePaperWaiver}
            onCancelOrder={handleCancelOrder}
            recordingCash={recordingCash}
            signingWaiver={signingWaiver}
            cancelling={cancelling}
          />

          <TaskDetailActions
            isDropOff={isDropOff}
            isToday={isToday}
            currentStatus={currentStatus}
            processing={processing}
            uploadingImages={uploadingImages}
            onEnRoute={handleEnRoute}
            onArrived={handleArrived}
            onImageUpload={handleImageUpload}
            onDropOffComplete={handleDropOffComplete}
            onPickupComplete={handlePickupComplete}
          />

          {/* Photos */}
          {(task.taskStatus?.deliveryImages?.length || task.taskStatus?.damageImages?.length) ? (
            <div className="border-t border-slate-200 pt-6">
              <h3 className="font-bold text-slate-900 mb-4">Photos</h3>
              {task.taskStatus.deliveryImages && task.taskStatus.deliveryImages.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold text-sm text-slate-700 mb-2">Delivery Photos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {task.taskStatus.deliveryImages.map((url, idx) => (
                      <img key={idx} src={url} alt={`Delivery ${idx + 1}`} className="w-full h-24 object-cover rounded-lg border border-slate-200" />
                    ))}
                  </div>
                </div>
              )}
              {task.taskStatus.damageImages && task.taskStatus.damageImages.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-slate-700 mb-2">Damage Photos</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {task.taskStatus.damageImages.map((url, idx) => (
                      <img key={idx} src={url} alt={`Damage ${idx + 1}`} className="w-full h-24 object-cover rounded-lg border border-red-200" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
