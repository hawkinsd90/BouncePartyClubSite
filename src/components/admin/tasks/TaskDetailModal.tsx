import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { formatCurrency } from '../../../lib/pricing';
import { createShortPortalLink } from '../../../lib/portal/portalShortLink';
import type { ShortPortalLinkResult } from '../../../lib/portal/portalShortLink';
import { decideActionRequiredSms, decideEnRouteReminders } from '../../../lib/notifications/notificationDecision';
import { showAlert, showConfirm, showModal } from '../../common/CustomModal';
import { getCurrentLocation, calculateETA } from '../../../lib/routing/crewLocationEta';
import { Task } from '../../../hooks/admin/useCalendarTasks';
import { getStopNumber } from '../../../lib/tasks/calendarUtils';
import { TaskDetailCustomerInfo } from './detail/TaskDetailCustomerInfo';
import { TaskDetailOrderManagement } from './detail/TaskDetailOrderManagement';
import { TaskDetailActions } from './detail/TaskDetailActions';
import { PickupCompletionSummary, CompletionSummaryData } from './detail/PickupCompletionSummary';
import { TaskDetailHeader } from './detail/TaskDetailHeader';
import { TaskDetailMobileActionBar } from './detail/TaskDetailMobileActionBar';
import { TaskDetailCompletedBanner } from './detail/TaskDetailCompletedBanner';
import { TaskDetailDateWarning } from './detail/TaskDetailDateWarning';
import { TaskDetailEquipmentCard } from './detail/TaskDetailEquipmentCard';
import { TaskDetailNotesCard } from './detail/TaskDetailNotesCard';
import { TaskDetailPhotosGrid } from './detail/TaskDetailPhotosGrid';
import { getRoutePool } from './detail/taskRoutePool';
import { uploadTaskPhotos, buildPhotoUploadSummary } from './detail/taskPhotoUpload';
import { getOrCreateTaskStatusRow } from '../../../lib/tasks/taskStatusService';
import {
  buildEnRouteMessage, buildEnRouteResultMessage, buildArrivedMessage, buildArrivedResultMessage,
  buildDropOffRulesMessage, buildDropOffResultMessage, buildPickupCompletionSummary,
} from './detail/taskNotificationMessages';
import { postSessionEdge, postTaskSms, currentAccessToken } from './detail/taskEdgeRequests';
import { getPublicBusinessSettings } from '../../../lib/core/adminSettingsCache';
import { useAuth } from '../../../contexts/AuthContext';
import { localDateKey } from '../../../lib/core/localDate';
import { decideEvidence, isEvidenceRequiredError, parseEvidenceState, type EvidenceKind } from '../../../lib/tasks/evidenceRule';
import { EvidenceOverrideModal } from './detail/EvidenceOverrideModal';
import { ReasonModal } from './detail/ReasonModal';
import { shouldBlockForStartMileage, START_MILEAGE_PROMPTS, type MileageGatedAction } from '../../../lib/core/startMileage';

export type { Task };

interface TaskDetailModalProps {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdate: () => void;
  onRefresh?: () => void;
  onBack?: () => void;
  onOpenMileageModal?: () => void;
  // Bumped by the parent each time a mileage reading is saved, so the log is read again (En Route must stop asking for a start reading).
  mileageVersion?: number;
}

export function TaskDetailModal({ task, allTasks, onClose, onUpdate, onRefresh, onBack, onOpenMileageModal, mileageVersion = 0 }: TaskDetailModalProps) {
  const refresh = onRefresh || onUpdate;
  // Admin/Master get the money and order-management controls; crew keeps the field workflow (database policy already limits what crew can read).
  const { isAdmin } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [chargingCard, setChargingCard] = useState(false);
  const [recordingCash, setRecordingCash] = useState(false);
  const [recordingCheck, setRecordingCheck] = useState(false);
  const [signingWaiver, setSigningWaiver] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [mileageLog, setMileageLog] = useState<any>(null);
  // Owner setting. Required until the setting has loaded and says otherwise (fail closed).
  const [requireStartMileage, setRequireStartMileage] = useState(true);
  // Admin override of the required photo: the open request (its kind and the promise to answer with the reason, or null for "go back").
  const [overrideRequest, setOverrideRequest] = useState<{ kind: EvidenceKind; answer: (reason: string | null) => void } | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  // The reason for marking a waiver signed on paper (asked in the app; the browser's built-in prompt box does not work reliably on phones).
  const [paperWaiverAsk, setPaperWaiverAsk] = useState<{ answer: (reason: string | null) => void } | null>(null);
  // File pickers live in the page (not created on the fly) so a phone browser keeps them across re-renders while the camera is open.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoKindRef = useRef<{ isDamage?: boolean }>({});
  const waiverInputRef = useRef<HTMLInputElement>(null);
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
    let cancelled = false;
    getPublicBusinessSettings()
      .then((settings) => { if (!cancelled) setRequireStartMileage(settings.require_start_mileage); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // The one start-mileage gate for every crew action. Returns true when the action may go ahead.
  async function passesStartMileageGate(action: MileageGatedAction): Promise<boolean> {
    if (!shouldBlockForStartMileage(requireStartMileage, mileageLog)) return true;
    if (action === 'en_route') {
      const ok = await showConfirm(START_MILEAGE_PROMPTS.en_route);
      if (ok) {
        if (onOpenMileageModal) onOpenMileageModal();
        else showAlert('Please use the "Start Day Mileage" button at the top of the day view to record your starting mileage, then return here to mark this task as En Route.');
      }
    } else {
      showAlert(START_MILEAGE_PROMPTS[action]);
    }
    return false;
  }

  // The required delivery / pickup photo (the database enforces it too). Returns true when the task may be completed.
  async function passesEvidenceGate(kind: EvidenceKind): Promise<boolean> {
    let state = null;
    try {
      const taskStatusId = await ensureTaskStatus();
      const { data, error } = await supabase.rpc('get_task_evidence_state' as never, { p_task_status_id: taskStatusId } as never);
      // Lookup failed (offline, or the database does not have the rule yet): carry on, the database decides.
      if (!error) state = parseEvidenceState(data);
      const decision = decideEvidence(state, kind, isAdmin);
      if (decision.action === 'proceed') return true;
      if (decision.action === 'blocked') {
        showAlert(decision.message);
        return false;
      }
      // Admin: offer the controlled override (reason recorded with name and time).
      const reason = await new Promise<string | null>((resolve) => setOverrideRequest({ kind, answer: resolve }));
      if (reason === null) return false;
      setOverrideBusy(true);
      const { error: overrideError } = await supabase.rpc('override_task_evidence' as never, { p_task_status_id: taskStatusId, p_reason: reason } as never);
      if (overrideError) {
        showAlert('The override could not be recorded: ' + overrideError.message);
        return false;
      }
      return true;
    } catch (e: any) {
      showAlert('Could not check the photo requirement: ' + (e?.message ?? 'unknown error'));
      return false;
    } finally {
      setOverrideBusy(false);
      setOverrideRequest(null);
    }
  }

  useEffect(() => {
    async function loadMileageLog() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const dateStr = localDateKey(task.date);
        const { data } = await supabase
          .from('daily_mileage_logs').select('*')
          .eq('date', dateStr).eq('user_id', user.id).maybeSingle();
        setMileageLog(data);
      } catch (error) { console.error('Error loading mileage log:', error); }
    }
    loadMileageLog();
  }, [task.date, mileageVersion]);

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

    if (!(await passesStartMileageGate('en_route'))) return;

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
      const hasActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
      let enRouteLinkResult: ShortPortalLinkResult = { success: false, error: 'No action required' };
      if (hasActionRequirement) {
        enRouteLinkResult = await createShortPortalLink(task.orderId, supabase, task.date?.toISOString());
      }
      const msg = buildEnRouteMessage({
        customerName: task.customerName,
        taskType: task.type,
        etaStart: tf(etaStart),
        etaEnd: tf(etaEnd),
        etaDistance,
        waiverSigned: task.waiverSigned,
        balanceDue: task.balanceDue,
        hasPets: task.hasPets,
        hasActionRequirement,
        linkResult: enRouteLinkResult,
      });

      const enRouteDecision = decideActionRequiredSms({
        hasActionRequirement,
        linkResult: enRouteLinkResult,
        messageType: 'en_route_action_required',
      });

      let smsFailureError: string | undefined;

      if (!enRouteDecision.shouldSendSms) {
        smsWarning = 'Customer notification failed: unable to create portal link';
        smsFailureError = enRouteDecision.failureRecord?.error;
        if (enRouteDecision.failureRecord && task.customerPhone?.trim()) {
          try {
            const { error: logError } = await supabase.from('notification_failures').insert({
              notification_type: 'sms',
              intended_recipient: task.customerPhone,
              subject: 'En Route notification not sent',
              error_message: enRouteDecision.failureRecord.error,
              context: { orderId: task.orderId, messageType: 'en_route_action_required', source: 'TaskDetailModal' },
            });
            if (logError) console.error('[TaskDetailModal] Failed to log notification failure:', logError);
          } catch (logErr) {
            console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
          }
        }
      } else {
        const sms = await postTaskSms({ to: task.customerPhone, message: msg, orderId: task.orderId }, 'En Route');
        if (!sms.ok) { smsWarning = sms.warning; smsFailureError = sms.failureError; }
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

      const successMsg = buildEnRouteResultMessage({ smsWarning, etaCalcErr, etaMinutes, etaDistance, workflowStatusFailed: !!wfErr });
      showAlert(successMsg);
      refresh();
    } catch (e: any) { console.error('Error en route:', e); showAlert('Failed to send notification: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handleArrived() {
    const confirmed = await showConfirm(`Mark as Arrived at ${task.customerName}'s location?\n\nThis will notify the customer that the crew has arrived.`);
    if (!confirmed) return;
    if (!(await passesStartMileageGate('arrived'))) return;
    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();
      let smsWarn: string | null = null;
      const hasArrivedActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
      let arrivedLinkResult: ShortPortalLinkResult = { success: false, error: 'No action required' };
      if (hasArrivedActionRequirement) {
        arrivedLinkResult = await createShortPortalLink(task.orderId, supabase, task.date?.toISOString());
      }
      const msg = buildArrivedMessage({
        taskType: task.type,
        waiverSigned: task.waiverSigned,
        balanceDue: task.balanceDue,
        hasPets: task.hasPets,
        hasActionRequirement: hasArrivedActionRequirement,
        linkResult: arrivedLinkResult,
      });

      const arrivedDecision = decideActionRequiredSms({
        hasActionRequirement: hasArrivedActionRequirement,
        linkResult: arrivedLinkResult,
        messageType: 'arrived_action_required',
      });

      if (!arrivedDecision.shouldSendSms) {
        smsWarn = 'Customer notification failed: unable to create portal link';
        if (arrivedDecision.failureRecord && task.customerPhone?.trim()) {
          try {
            const { error: logError } = await supabase.from('notification_failures').insert({
              notification_type: 'sms',
              intended_recipient: task.customerPhone,
              subject: 'Arrived notification not sent',
              error_message: arrivedDecision.failureRecord.error,
              context: { orderId: task.orderId, messageType: 'arrived_action_required', source: 'TaskDetailModal' },
            });
            if (logError) console.error('[TaskDetailModal] Failed to log notification failure:', logError);
          } catch (logErr) {
            console.error('[TaskDetailModal] Failed to log notification failure:', logErr);
          }
        }
      } else {
        const sms = await postTaskSms({ to: task.customerPhone, message: msg, orderId: task.orderId }, 'Arrived');
        if (!sms.ok) { smsWarn = sms.warning; }
      }

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'arrived', arrived_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error('Failed to update task status: ' + taskErr.message);

      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'arrived' }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (arrived):', wfErr.message);

      const arrivedMsg = buildArrivedResultMessage({ smsWarn, workflowStatusFailed: !!wfErr });
      showAlert(arrivedMsg);
      refresh();
    } catch (e: any) { console.error('Error arrived:', e); showAlert('Failed to send notification: ' + e.message); }
    finally { setProcessing(false); }
  }

  function handleImageUpload(isDamage?: boolean) {
    photoKindRef.current = { isDamage };
    photoInputRef.current?.click();
  }

  async function handlePhotoFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const isDamage = photoKindRef.current.isDamage;
    const files: File[] = Array.from(e.target.files || []);
    e.target.value = '';
    {
      if (files.length === 0) return;

      console.log(`[photos] Selected ${files.length} file(s) for ${isDamage ? 'damage' : 'delivery'} upload`);

      setUploadingImages(true);

      try {
        const taskStatusId = await ensureTaskStatus();

        const result = await uploadTaskPhotos(
          { files, orderId: task.orderId, taskType: task.type, taskStatusId, isDamage },
          { client: supabase },
        );
        if (result.uploadedPaths.length > 0) {
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
    }
  }

  async function handleDropOffComplete() {
    if (!(await passesStartMileageGate('drop_off'))) return;
    if (!(await passesEvidenceGate('delivery'))) return;
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
      const msg = buildDropOffRulesMessage({ pickupPreference: task.pickupPreference, eventEndTime: task.eventEndTime, numInflatables: task.numInflatables });

      let smsWarn: string | null = null;
      const sms = await postTaskSms({ to: task.customerPhone, message: msg, orderId: task.orderId, mediaUrls: [] }, 'Drop-off');
      if (!sms.ok) smsWarn = sms.warning;

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'completed', completed_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error(isEvidenceRequiredError(taskErr) ? 'A delivery photo is required before this can be completed.' : 'Failed to update task status: ' + taskErr.message);

      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'setup_completed' }).eq('id', task.orderId);
      if (wfErr) console.warn('workflow_status update failed (setup_completed):', wfErr.message);

      const dropOffMsg = buildDropOffResultMessage({ smsWarn, workflowStatusFailed: !!wfErr });
      showAlert(dropOffMsg);
      refresh();
    } catch (e: any) { console.error('Drop-off complete error:', e); showAlert('Failed to complete delivery: ' + e.message); }
    finally { setProcessing(false); }
  }

  async function handlePickupComplete() {
    if (!(await passesStartMileageGate('pickup'))) return;
    if (!(await passesEvidenceGate('pickup'))) return;

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
      // The notification relays accept the signed-in staff member's session token, not the public anon key.
      const relayToken = await currentAccessToken();
      try {
        if (!relayToken) throw new Error('not signed in');
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
          method: 'POST', headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateKey: 'pickup_thanks_sms', orderId: task.orderId }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); smsWarn = d.error || 'SMS failed to send'; }
      } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; }

      try {
        if (!relayToken) throw new Error('not signed in');
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST', headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateName: 'pickup_complete', orderId: task.orderId }),
        });
        if (!r.ok) console.warn('Pickup complete email failed (non-blocking)');
      } catch (e: any) { console.warn('Pickup email error (non-blocking):', e); }

      // workflow_status MUST be written before task_status so the DB trigger
      // reads 'pickup_in_progress' when it fires and advances orders.status → completed.
      const { error: wfErr } = await supabase.from('orders').update({ workflow_status: 'pickup_in_progress' }).eq('id', task.orderId);
      if (wfErr) throw new Error('Failed to set pickup workflow status: ' + wfErr.message);

      const { error: taskErr } = await supabase.from('task_status').update({ status: 'completed', completed_time: new Date().toISOString() }).eq('id', taskStatusId);
      if (taskErr) throw new Error(isEvidenceRequiredError(taskErr) ? 'A pickup photo is required before this can be completed.' : 'Failed to update task status: ' + taskErr.message);

      if (smsWarn) {
        showAlert(`Pickup marked complete. Warning: ${smsWarn}.`);
      }

      const summary: CompletionSummaryData = buildPickupCompletionSummary(task, hasBalance, new Date());
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
      await postSessionEdge({
        functionName: 'record-cash-payment',
        accessToken: session?.access_token,
        body: { orderId: task.orderId, amountCents: balancePaymentCents, tipCents },
        fallbackMessage: 'Failed to record payment',
      });
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
      await postSessionEdge({
        functionName: 'record-check-payment',
        accessToken: session?.access_token,
        body: { orderId: task.orderId, amountCents: balancePaymentCents, checkNumber, tipCents },
        fallbackMessage: 'Failed to record payment',
      });
      const successMsg = tipCents > 0
        ? `Check payment recorded! Balance: ${formatCurrency(balancePaymentCents)} + Tip: ${formatCurrency(tipCents)} = ${formatCurrency(totalReceivedCents)} (Check #${checkNumber})`
        : `Check payment of ${formatCurrency(balancePaymentCents)} (Check #${checkNumber}) recorded successfully!`;
      showAlert(successMsg);
      refresh();
    } catch (e: any) { console.error('Check payment error:', e); showAlert('Failed to record payment: ' + e.message); }
    finally { setRecordingCheck(false); }
  }

  async function handlePaperWaiver() {
    const overrideReason = await new Promise<string | null>((resolve) => setPaperWaiverAsk({ answer: resolve }));
    setPaperWaiverAsk(null);
    if (!overrideReason || !overrideReason.trim()) return;

    setSigningWaiver(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('orderId', task.orderId);
      form.append('uploadSource', 'admin_no_photo');
      form.append('overrideReason', overrideReason.trim());

      await postSessionEdge({
        functionName: 'upload-physical-waiver',
        accessToken: session?.access_token,
        body: form,
        fallbackMessage: 'Failed to record waiver',
      });
      showAlert('Waiver marked as signed in person (no photo).');
      refresh();
    } catch (e: any) { console.error('Paper waiver error:', e); showAlert('Failed to mark waiver: ' + e.message); }
    finally { setSigningWaiver(false); }
  }

  function handlePaperWaiverUpload() {
    waiverInputRef.current?.click();
  }

  async function handleWaiverFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    {
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

        await postSessionEdge({
          functionName: 'upload-physical-waiver',
          accessToken: session?.access_token,
          body: form,
          fallbackMessage: 'Failed to upload waiver',
        });
        showAlert('Paper waiver uploaded successfully.');
        refresh();
      } catch (e: any) { console.error('Paper waiver upload error:', e); showAlert('Failed to upload waiver: ' + e.message); }
      finally { setSigningWaiver(false); }
    }
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
      await postSessionEdge({
        functionName: 'charge-deposit',
        accessToken: session?.access_token,
        body: { orderId: task.orderId, paymentAmountCents: amountCents, tipCents: 0, selectedPaymentType: 'balance' },
        fallbackMessage: 'Failed to charge card',
        requireSuccess: true,
      });
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
      await postSessionEdge({
        functionName: 'customer-cancel-order',
        accessToken: session?.access_token,
        body: { orderId: task.orderId, cancellationReason: cancelReason, adminOverrideRefund: shouldRefund },
        fallbackMessage: 'Failed to cancel order',
      });
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
      <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoFilesChosen} aria-hidden="true" tabIndex={-1} />
      <input ref={waiverInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleWaiverFileChosen} aria-hidden="true" tabIndex={-1} />
      {paperWaiverAsk && (
        <ReasonModal
          title={`Mark waiver signed on paper for ${task.customerName}`}
          description={'No photo will be attached. Say why, for example: Crew collected the paper copy, will scan later.'}
          placeholder="Crew collected paper copy, will scan later"
          confirmLabel="Mark signed"
          onSubmit={(reason) => paperWaiverAsk.answer(reason)}
          onCancel={() => paperWaiverAsk.answer(null)}
        />
      )}
      {overrideRequest && (
        <EvidenceOverrideModal
          kind={overrideRequest.kind}
          busy={overrideBusy}
          onSubmit={(reason) => overrideRequest.answer(reason)}
          onCancel={() => overrideRequest.answer(null)}
        />
      )}
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
          canOpenOrder={isAdmin}
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

          <TaskDetailCustomerInfo task={task} isAdmin={isAdmin} onRefundChanged={refresh} />

          {/* Equipment */}
          <TaskDetailEquipmentCard items={task.items} isDropOff={isDropOff} />

          {/* Notes */}
          {task.notes && <TaskDetailNotesCard notes={task.notes} />}

          <TaskDetailOrderManagement
            task={task}
            isAdmin={isAdmin}
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
              taskStatusId={task.taskStatus.id}
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
