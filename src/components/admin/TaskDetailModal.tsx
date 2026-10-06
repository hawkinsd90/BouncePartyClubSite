import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/pricing';
import { createShortPortalLink } from '../../lib/utils';
import { decideActionRequiredSms, decideEnRouteReminders } from '../../lib/notificationDecision';
import { showAlert, showConfirm, showModal } from '../common/CustomModal';
import { getCurrentLocation, calculateETA } from '../../lib/googleMaps';
import { Task } from '../../hooks/useCalendarTasks';
import { getStopNumber } from '../../lib/calendarUtils';
import { TaskDetailCustomerInfo } from './task-detail/TaskDetailCustomerInfo';
import { TaskDetailOrderManagement } from './task-detail/TaskDetailOrderManagement';
import { TaskDetailActions } from './task-detail/TaskDetailActions';
import { PickupCompletionSummary, CompletionSummaryData } from './task-detail/PickupCompletionSummary';
import { TaskDetailHeader } from './task-detail/TaskDetailHeader';
import { TaskDetailMobileActionBar } from './task-detail/TaskDetailMobileActionBar';
import { TaskDetailCompletedBanner } from './task-detail/TaskDetailCompletedBanner';
import { TaskDetailDateWarning } from './task-detail/TaskDetailDateWarning';
import { TaskDetailEquipmentCard } from './task-detail/TaskDetailEquipmentCard';
import { TaskDetailNotesCard } from './task-detail/TaskDetailNotesCard';
import { TaskDetailPhotosGrid } from './task-detail/TaskDetailPhotosGrid';
import { getRoutePool } from './task-detail/taskRoutePool';
import { uploadTaskPhotos, buildPhotoUploadSummary } from './task-detail/taskPhotoUpload';
import { getOrCreateTaskStatusRow } from '../../lib/taskStatusService';

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
  const [chargingCard, setChargingCard] = useState(false);
  const [recordingCash, setRecordingCash] = useState(false);
  const [recordingCheck, setRecordingCheck] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mileageLog, setMileageLog] = useState<any>(null);
  const [completionSummary, setCompletionSummary] = useState<CompletionSummaryData | null>(null);
  const [futureTaskOverride, setFutureTaskOverride] = useState(false);
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

  // Use shared route-stop logic so stop numbers match DayView/TaskCard exactly.
  // Only active (non-excluded, non-completed) route stops are counted.
  const stopNumber = getStopNumber(task, allTasks);
  // Route-pool derivation (stop count + the pool the move-up/down arrows use) lives in getRoutePool.
  const { activeStopsCount, tasksOfSameType } = getRoutePool(task, allTasks);
  const currentIndex = tasksOfSameType.findIndex(t => t.id === task.id);
  const canMoveUp = stopNumber > 0 && currentIndex > 0;
  const canMoveDown = stopNumber > 0 && currentIndex !== -1 && currentIndex < tasksOfSameType.length - 1;

  async function ensureTaskStatus(): Promise<string> {
    if (task.taskStatus?.id) return task.taskStatus.id;

    const dateStr = format(task.date, 'yyyy-MM-dd');

    // Existing-row lookup, minimal pending insert and 23505 race recovery live in the shared service
    const { row } = await getOrCreateTaskStatusRow(supabase, {
      orderId: task.orderId,
      taskType: task.type,
      taskDate: dateStr,
      select: 'id',
    });
    return row.id;
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
        const { error: locErr } = await supabase.from('crew_location_history').insert({ latitude: loc.lat, longitude: loc.lng });
        if (locErr) console.warn('crew_location_history insert failed:', locErr.message);
      } catch (e: any) { console.warn('ETA calc failed:', e); etaCalcErr = e.message; }

      const eta = new Date(Date.now() + etaMinutes * 60000);
      const etaStart = new Date(eta.getTime() - 10 * 60000);
      const etaEnd = new Date(eta.getTime() + 10 * 60000);
      const tf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      let smsWarning: string | null = null;
      let msg = `Hello ${task.customerName.split(' ')[0]}! We're on our way to ${task.type === 'drop-off' ? 'deliver' : 'pick up'} your rental. ETA: ${tf(etaStart)} - ${tf(etaEnd)}`;
      if (etaDistance) msg += ` (${etaDistance} away)`;
      msg += '. ';
      const hasActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
      let enRouteLinkResult: any = { success: false, error: 'No action required' };
      if (hasActionRequirement) {
        msg += '\n\n';
        if (!task.waiverSigned) msg += '⚠️ IMPORTANT: Your waiver is not signed yet. ';
        if (task.balanceDue > 0) msg += `⚠️ IMPORTANT: Balance due: ${formatCurrency(task.balanceDue)}. `;
        enRouteLinkResult = await createShortPortalLink(task.orderId, supabase, task.date?.toISOString());
        if (enRouteLinkResult.success) {
          msg += `\n\nPlease complete these before we arrive: ${enRouteLinkResult.url}`;
        }
      }
      if (task.type === 'drop-off') {
        msg += '\n\nPlease ensure there is a clear path for delivery and setup.';
        if (task.hasPets) {
          msg += ' Please also clear the backyard area of any pet waste before we arrive.';
        }
        msg += ' See you soon!';
      } else {
        if (task.hasPets) {
          msg += ' Please make sure all pets are secured inside before we arrive.';
        }
      }

      const enRouteDecision = decideActionRequiredSms({
        hasActionRequirement,
        linkResult: enRouteLinkResult,
        messageType: 'en_route_action_required',
      });

      let smsFailureError: string | undefined;

      if (!enRouteDecision.shouldSendSms) {
        smsWarning = 'Customer notification failed: unable to create portal link';
        smsFailureError = enRouteDecision.failureRecord?.error;
        if (enRouteDecision.failureRecord) {
          try {
            await supabase.from('notification_failures' as any).insert({
              order_id: task.orderId,
              channel: enRouteDecision.failureRecord.channel,
              message_type: enRouteDecision.failureRecord.message_type,
              error_message: enRouteDecision.failureRecord.error,
              created_at: new Date().toISOString(),
            });
          } catch (logErr) {
            console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
          }
        }
      } else {
        try {
          const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
            method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: task.customerPhone, message: msg, orderId: task.orderId }),
          });
          if (!r.ok) { smsWarning = 'SMS failed to send'; smsFailureError = `SMS endpoint returned ${r.status}`; console.warn('En Route SMS failed:', await r.text()); }
        } catch (e: any) { smsWarning = 'SMS failed: ' + e.message; smsFailureError = e.message; }
      }

      const smsSentSuccessfully = enRouteDecision.shouldSendSms && smsWarning === null;

      const enRouteMessageType = hasActionRequirement ? 'en_route_action_required' : 'en_route';
      const reminderDecision = decideEnRouteReminders({
        smsSentSuccessfully,
        hasActionRequirement,
        waiverSigned: task.waiverSigned,
        balanceDue: task.balanceDue,
        messageType: enRouteMessageType,
        failureError: smsFailureError,
      });

      if (!smsSentSuccessfully && enRouteDecision.shouldSendSms && reminderDecision.failureRecord) {
        try {
          await supabase.from('notification_failures' as any).insert({
            order_id: task.orderId,
            channel: reminderDecision.failureRecord.channel,
            message_type: reminderDecision.failureRecord.message_type,
            error_message: reminderDecision.failureRecord.error,
            created_at: new Date().toISOString(),
          });
        } catch (logErr) {
          console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
        }
      }

      const { error: taskErr } = await supabase.from('task_status').update({
        status: 'en_route', en_route_time: new Date().toISOString(),
        eta_sent: reminderDecision.etaSent, waiver_reminder_sent: reminderDecision.waiverReminderSent,
        payment_reminder_sent: reminderDecision.paymentReminderSent, calculated_eta_minutes: etaMinutes,
        gps_lat: gpsLat, gps_lng: gpsLng, eta_calculation_error: etaCalcErr,
      }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const workflowValue = task.type === 'drop-off' ? 'on_the_way' : 'pickup_in_progress';
      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: workflowValue }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (en route):', wfErr.message);

      let successMsg = smsWarning && etaCalcErr ? `En Route saved (fallback ETA), but the customer notification failed.`
        : smsWarning ? `En Route saved, but the customer notification failed.`
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
      let smsWarn: string | null = null;
      let msg = `We have arrived at your location! `;
      const hasArrivedActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
      let arrivedLinkResult: any = { success: false, error: 'No action required' };
      if (hasArrivedActionRequirement) {
        msg += '\n\n⚠️ Before we unload:\n';
        if (!task.waiverSigned) msg += '• Please sign the waiver\n';
        if (task.balanceDue > 0) msg += `• Complete payment (${formatCurrency(task.balanceDue)})\n`;
        arrivedLinkResult = await createShortPortalLink(task.orderId, supabase, task.date?.toISOString());
        if (arrivedLinkResult.success) {
          msg += `\nComplete at: ${arrivedLinkResult.url}\n\n`;
        }
      }
      if (task.type === 'drop-off') {
        msg += 'Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location';
        if (task.hasPets) {
          msg += '\n• Make sure all pets are secured inside';
        }
      } else {
        msg += "We'll begin pickup shortly.";
        if (task.hasPets) {
          msg += ' Please make sure all pets are secured inside before we arrive.';
        }
        msg += ' Thank you for using Bounce Party Club!';
      }

      const arrivedDecision = decideActionRequiredSms({
        hasActionRequirement: hasArrivedActionRequirement,
        linkResult: arrivedLinkResult,
        messageType: 'arrived_action_required',
      });

      let arrivedSmsFailureError: string | undefined;

      if (!arrivedDecision.shouldSendSms) {
        smsWarn = 'Customer notification failed: unable to create portal link';
        arrivedSmsFailureError = arrivedDecision.failureRecord?.error;
        if (arrivedDecision.failureRecord) {
          try {
            await supabase.from('notification_failures' as any).insert({
              order_id: task.orderId,
              channel: arrivedDecision.failureRecord.channel,
              message_type: arrivedDecision.failureRecord.message_type,
              error_message: arrivedDecision.failureRecord.error,
              created_at: new Date().toISOString(),
            });
          } catch (logErr) {
            console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
          }
        }
      } else {
        try {
          const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
            method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: task.customerPhone, message: msg, orderId: task.orderId }),
          });
          if (!r.ok) { smsWarn = 'SMS failed to send'; arrivedSmsFailureError = `SMS endpoint returned ${r.status}`; console.warn('Arrived SMS failed:', await r.text()); }
        } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; arrivedSmsFailureError = e.message; }
      }

      const arrivedSmsSentSuccessfully = arrivedDecision.shouldSendSms && smsWarn === null;

      if (!arrivedSmsSentSuccessfully && arrivedDecision.shouldSendSms) {
        const arrivedMessageType = hasArrivedActionRequirement ? 'arrived_action_required' : 'arrived';
        try {
          await supabase.from('notification_failures' as any).insert({
            order_id: task.orderId,
            channel: 'sms',
            message_type: arrivedMessageType,
            error_message: arrivedSmsFailureError || 'SMS send failed',
            created_at: new Date().toISOString(),
          });
        } catch (logErr) {
          console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
        }
      }

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'arrived', arrived_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'arrived' }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (arrived):', wfErr.message);

      let arrivedMsg = smsWarn ? `Arrived saved, but the customer notification failed.` : 'Arrived and customer notified successfully!';
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
      const files: File[] = Array.from(e.target.files || []);
      if (files.length === 0) return;

      console.log(`[photos] Selected ${files.length} file(s) for ${isDamage ? 'damage' : 'delivery'} upload`);

      setUploadingImages(true);

      try {
        const taskStatusId = await ensureTaskStatus();

        const result = await uploadTaskPhotos(
          { files, orderId: task.orderId, taskType: task.type, taskStatusId, isDamage },
          { client: supabase },
        );
        if (result.uploadedUrls.length > 0) {
          refresh();
        }

        showAlert(buildPhotoUploadSummary(result, isDamage));
      } catch (e: any) {
        console.error('[photos] Upload error:', e);
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('size') || msg.includes('maximum')) {
          showAlert('Photo is too large. Please try again, or take a lower-resolution photo.');
        } else {
          showAlert('Failed to upload photos. Please try again.');
        }
      } finally {
        setUploadingImages(false);
      }
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
      const msg = `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• NO HANGING OR CLIMBING ON THE NETS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;

      let smsWarn: string | null = null;
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: task.customerPhone, message: msg, orderId: task.orderId, mediaUrls: [] }),
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

    const hasBalance = task.balanceDue > 0;
    if (hasBalance) {
      const override = await showConfirm(
        `⚠️ Outstanding balance of ${formatCurrency(task.balanceDue)} has not been collected.\n\nAre you sure you want to mark this pickup as complete without full payment?\n\nClick OK to complete anyway, or Cancel to go back and collect payment first.`
      );
      if (!override) return;
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

      if (smsWarn) {
        showAlert(`Pickup marked complete. Warning: ${smsWarn}.`);
      }

      const paymentMethods = [...new Set(
        (task.payments || [])
          .filter((p: any) => p.status === 'paid' || p.status === 'succeeded')
          .map((p: any) => {
            const method = (p.payment_method || '').toLowerCase();
            if (method === 'cash') return 'Cash';
            if (method === 'check') return 'Check';
            return 'Card';
          })
      )];

      const summary: CompletionSummaryData = {
        orderNumber: task.orderNumber,
        customerName: task.customerName,
        totalCents: task.total,
        depositPaidCents: task.depositPaidCents,
        balancePaidCents: task.balancePaidCents,
        tipCents: task.tipCents,
        remainingBalanceCents: hasBalance ? task.balanceDue : 0,
        paymentMethods,
        waiverSigned: task.waiverSigned,
        completionTime: new Date(),
        hadBalanceWarning: hasBalance,
      };
      setCompletionSummary(summary);
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
      const curOrder = cur.taskStatus?.sortOrder ?? idx; const swapOrder = swap.taskStatus?.sortOrder ?? swapIdx;
      const updates: Promise<{ error: any }>[] = [];
      if (cur.taskStatus?.id) updates.push(supabase.from('task_status').update({ sort_order: swapOrder }).eq('id', cur.taskStatus.id) as unknown as Promise<{ error: any }>);
      if (swap.taskStatus?.id) updates.push(supabase.from('task_status').update({ sort_order: curOrder }).eq('id', swap.taskStatus.id) as unknown as Promise<{ error: any }>);
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

  async function handleCashPayment(balancePaymentCents: number, tipCents: number = 0, totalReceivedCents: number = balancePaymentCents) {
    const confirmLines = [
      `Record cash payment from ${task.customerName}?`,
      '',
      `  Balance payment:  ${formatCurrency(balancePaymentCents)}`,
      `  Tip:              ${formatCurrency(tipCents)}`,
      `  Total received:   ${formatCurrency(totalReceivedCents)}`,
      '',
      'This will send a receipt email to the customer.',
    ];
    const confirmed = await showConfirm(confirmLines.join('\n'));
    if (!confirmed) return;
    setRecordingCash(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-cash-payment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, amountCents: balancePaymentCents, tipCents }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to record payment');
      const successMsg = tipCents > 0
        ? `Cash payment recorded! Balance: ${formatCurrency(balancePaymentCents)} + Tip: ${formatCurrency(tipCents)} = ${formatCurrency(totalReceivedCents)}`
        : `Cash payment of ${formatCurrency(balancePaymentCents)} recorded successfully!`;
      showAlert(successMsg);
      refresh();
    } catch (e: any) { console.error('Cash payment error:', e); showAlert('Failed to record payment: ' + e.message); }
    finally { setRecordingCash(false); }
  }

  async function handleCheckPayment(balancePaymentCents: number, checkNumber: string, tipCents: number = 0, totalReceivedCents: number = balancePaymentCents) {
    const confirmLines = [
      `Record check payment from ${task.customerName}?`,
      '',
      `  Check #:          ${checkNumber}`,
      `  Balance payment:  ${formatCurrency(balancePaymentCents)}`,
      `  Tip:              ${formatCurrency(tipCents)}`,
      `  Total received:   ${formatCurrency(totalReceivedCents)}`,
      '',
      'This will send a receipt email to the customer.',
    ];
    const confirmed = await showConfirm(confirmLines.join('\n'));
    if (!confirmed) return;
    setRecordingCheck(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-check-payment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, amountCents: balancePaymentCents, checkNumber, tipCents }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to record payment');
      const successMsg = tipCents > 0
        ? `Check payment recorded! Balance: ${formatCurrency(balancePaymentCents)} + Tip: ${formatCurrency(tipCents)} = ${formatCurrency(totalReceivedCents)} (Check #${checkNumber})`
        : `Check payment of ${formatCurrency(balancePaymentCents)} (Check #${checkNumber}) recorded successfully!`;
      showAlert(successMsg);
      refresh();
    } catch (e: any) { console.error('Check payment error:', e); showAlert('Failed to record payment: ' + e.message); }
    finally { setRecordingCheck(false); }
  }

  async function handlePaperWaiver() {
    const overrideReason = window.prompt(
      `Mark waiver as signed in person for ${task.customerName} (no photo).\n\nProvide a reason (required):\ne.g., "Crew collected paper copy, will scan later"`
    );
    if (!overrideReason || !overrideReason.trim()) return;

    setSigningWaiver(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('orderId', task.orderId);
      form.append('uploadSource', 'admin_no_photo');
      form.append('overrideReason', overrideReason.trim());

      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-physical-waiver`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: form,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to record waiver');
      showAlert('Waiver marked as signed in person (no photo).');
      refresh();
    } catch (e: any) { console.error('Paper waiver error:', e); showAlert('Failed to mark waiver: ' + e.message); }
    finally { setSigningWaiver(false); }
  }

  async function handlePaperWaiverUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif') ||
          file.type === 'image/heic' || file.type === 'image/heif') {
        showAlert('HEIC photos are not supported. Please convert to JPEG first. On iPhone: Settings > Camera > Formats > Most Compatible');
        return;
      }

      setSigningWaiver(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const form = new FormData();
        form.append('file', file);
        form.append('orderId', task.orderId);
        form.append('uploadSource', 'admin_upload');

        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-physical-waiver`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}` },
          body: form,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed to upload waiver');
        showAlert('Paper waiver uploaded successfully.');
        refresh();
      } catch (e: any) { console.error('Paper waiver upload error:', e); showAlert('Failed to upload waiver: ' + e.message); }
      finally { setSigningWaiver(false); }
    };
    input.click();
  }

  async function handleChargeCard(amountCents: number) {
    const cardLabel = task.paymentMethodBrand && task.paymentMethodLastFour
      ? `${task.paymentMethodBrand} •••• ${task.paymentMethodLastFour}`
      : 'card on file';
    const confirmed = await showConfirm(
      `Charge ${formatCurrency(amountCents)} to ${cardLabel} for ${task.customerName}?\n\nThis will charge the card immediately and send a receipt email to the customer.`
    );
    if (!confirmed) return;
    setChargingCard(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/charge-deposit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: task.orderId, paymentAmountCents: amountCents, tipCents: 0, selectedPaymentType: 'balance' }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || 'Failed to charge card');
      showAlert(`Successfully charged ${formatCurrency(amountCents)} to ${cardLabel}. A receipt has been sent to the customer.`);
      refresh();
    } catch (e: any) { console.error('Charge card error:', e); showAlert('Failed to charge card: ' + e.message); }
    finally { setChargingCard(false); }
  }

  async function handleCancelOrder(cancelReason: string) {
    if (!cancelReason.trim() || cancelReason.trim().length < 10) {
      showAlert('Please provide a cancellation reason (minimum 10 characters)');
      return;
    }
    const shouldRefund = await showModal({
      message: `Does this cancellation require a refund for ${task.customerName}?\n\nNote: No refund will be processed automatically. You will need to issue it manually from the Payments tab.`,
      type: 'confirm',
      confirmText: 'Yes, Refund Needed',
      cancelText: 'No Refund',
    });
    const refundLabel = shouldRefund ? '✓ Refund intent will be recorded — issue manually from Payments tab' : '✗ No refund';
    const finalConfirm = await showConfirm(`Cancel order #${task.orderNumber} for ${task.customerName}?\n\nReason: ${cancelReason}\n\n${refundLabel}\n\nCustomer will be notified via SMS.`);
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
      const alertMsg = shouldRefund
        ? `Order cancelled. Refund intent recorded — please issue the refund from the Payments tab.`
        : `Order cancelled. No refund will be issued.`;
      showAlert(alertMsg);
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
        <TaskDetailHeader
          isDropOff={isDropOff}
          currentStatus={currentStatus}
          statusColor={statusColor}
          orderNumber={task.orderNumber}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          stopNumber={stopNumber}
          activeStopsCount={activeStopsCount}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          onBack={onBack}
          onClose={onClose}
          onOpenOrder={() => { onClose(); navigate(`/admin?tab=orders&subtab=single_order&orderId=${task.orderId}`); }}
          onReorder={handleReorder}
          onRefreshClick={async () => { setRefreshing(true); setLastUpdated(new Date()); await refresh(); setTimeout(() => setRefreshing(false), 500); }}
        />

        {/* Mobile action bar */}
        {isToday && currentStatus !== 'completed' && (
          <TaskDetailMobileActionBar
            isDropOff={isDropOff}
            processing={processing}
            uploadingImages={uploadingImages}
            onEnRoute={handleEnRoute}
            onArrived={handleArrived}
            onImageUpload={handleImageUpload}
            onDropOffComplete={handleDropOffComplete}
            onPickupComplete={handlePickupComplete}
          />
        )}

        <div className="p-4 sm:p-6 space-y-6">
          {/* Completed banner */}
          {currentStatus === 'completed' && (
            <TaskDetailCompletedBanner isDropOff={isDropOff} completedTime={task.taskStatus?.completedTime} />
          )}

          {/* Date warning */}
          {!isToday && (
            <TaskDetailDateWarning
              isFuture={isFuture}
              date={task.date}
              futureTaskOverride={futureTaskOverride}
              onOverrideChange={setFutureTaskOverride}
            />
          )}

          <TaskDetailCustomerInfo task={task} onRefund={handleRefund} refunding={refunding} />

          {/* Equipment */}
          <TaskDetailEquipmentCard items={task.items} isDropOff={isDropOff} />

          {/* Notes */}
          {task.notes && <TaskDetailNotesCard notes={task.notes} />}

          <TaskDetailOrderManagement
            task={task}
            onCashPayment={handleCashPayment}
            onCheckPayment={handleCheckPayment}
            onPaperWaiver={handlePaperWaiver}
            onCancelOrder={handleCancelOrder}
            onChargeCard={handleChargeCard}
            recordingCash={recordingCash}
            recordingCheck={recordingCheck}
            signingWaiver={signingWaiver}
            cancelling={cancelling}
            chargingCard={chargingCard}
          />

          <TaskDetailActions
            isDropOff={isDropOff}
            isToday={isToday || futureTaskOverride}
            currentStatus={currentStatus}
            processing={processing}
            uploadingImages={uploadingImages}
            onEnRoute={handleEnRoute}
            onArrived={handleArrived}
            onImageUpload={handleImageUpload}
            onDropOffComplete={handleDropOffComplete}
            onPickupComplete={handlePickupComplete}
            onPaperWaiverUpload={handlePaperWaiverUpload}
          />

          {/* Photos */}
          {(task.taskStatus?.deliveryImages?.length || task.taskStatus?.damageImages?.length) ? (
            <TaskDetailPhotosGrid
              deliveryImages={task.taskStatus.deliveryImages}
              damageImages={task.taskStatus.damageImages}
            />
          ) : null}
        </div>
      </div>

      {completionSummary && (
        <PickupCompletionSummary
          summary={completionSummary}
          onClose={() => { setCompletionSummary(null); onClose(); }}
        />
      )}
    </div>
  );
}
