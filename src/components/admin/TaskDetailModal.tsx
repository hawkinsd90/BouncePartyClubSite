import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { X, Navigation, CheckCircle, Camera, MessageCircle, ChevronUp, ChevronDown, Star, AlertTriangle, RefreshCw, RotateCcw, DollarSign, FileCheck, Ban, ExternalLink, ArrowLeft } from 'lucide-react';
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
  const [mileageLog, setMileageLog] = useState<any>(null);
  const currentStatus = task.taskStatus?.status || 'pending';
  const navigate = useNavigate();

  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const debouncedUpdate = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        setLastUpdated(new Date());
        refresh();
      }, 300);
    };

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
        debouncedUpdate
      )
      .subscribe();

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      supabase.removeChannel(channel);
    };
  }, [task.orderId, refresh]);

  useEffect(() => {
    async function loadMileageLog() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const dateStr = task.date.toISOString().split('T')[0];
        const { data } = await supabase
          .from('daily_mileage_logs')
          .select('*')
          .eq('date', dateStr)
          .eq('user_id', user.id)
          .maybeSingle();

        setMileageLog(data);
      } catch (error) {
        console.error('Error loading mileage log:', error);
      }
    }

    loadMileageLog();
  }, [task.date]);

  async function handleRefresh() {
    setRefreshing(true);
    setLastUpdated(new Date());
    await refresh();
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
        notes: null,
      })
      .select()
      .single();

    if (error) throw error;
    return data.id;
  }

  async function handleEnRoute() {
    if (!mileageLog || !mileageLog.start_mileage) {
      const confirmed = await showConfirm(
        'Starting mileage required before marking tasks as En Route.\n\nWould you like to record your starting mileage now?'
      );
      if (confirmed) {
        if (onOpenMileageModal) {
          onOpenMileageModal();
        } else {
          showAlert('Please use the "Start Day Mileage" button at the top of the day view to record your starting mileage, then return here to mark this task as En Route.');
        }
      }
      return;
    }

    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      let etaMinutes = 30;
      let etaDistance = '';
      let gpsLat = 0;
      let gpsLng = 0;
      let etaCalculationError: string | null = null;

      try {
        const crewLocation = await getCurrentLocation();
        gpsLat = crewLocation.lat;
        gpsLng = crewLocation.lng;

        const etaResult = await calculateETA(crewLocation, task.address);
        etaMinutes = etaResult.durationMinutes;
        etaDistance = etaResult.distanceText;

        const { error: locationInsertError } = await supabase.from('crew_location_history').insert({
          latitude: crewLocation.lat,
          longitude: crewLocation.lng,
          order_id: task.orderId,
        });
        if (locationInsertError) {
          console.warn('crew_location_history insert failed (non-blocking):', locationInsertError.message);
        }
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

      let smsWarning: string | null = null;
      try {
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
        if (!smsResponse.ok) {
          smsWarning = 'SMS failed to send';
          console.warn('En Route SMS failed:', await smsResponse.text());
        }
      } catch (smsError: any) {
        smsWarning = 'SMS failed: ' + smsError.message;
        console.warn('En Route SMS error:', smsError);
      }

      const { error: taskUpdateError } = await supabase
        .from('task_status')
        .update({
          status: 'en_route',
          en_route_time: new Date().toISOString(),
          eta_sent: smsWarning === null,
          waiver_reminder_sent: !task.waiverSigned,
          payment_reminder_sent: task.balanceDue > 0,
          calculated_eta_minutes: etaMinutes,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          eta_calculation_error: etaCalculationError,
        })
        .eq('id', taskStatusId);

      if (taskUpdateError) throw new Error('Failed to update task status: ' + taskUpdateError.message);

      let successMsg: string;
      if (smsWarning && etaCalculationError) {
        successMsg = `En Route saved (fallback ETA). Warning: ${smsWarning}.`;
      } else if (smsWarning) {
        successMsg = `En Route saved. Warning: ${smsWarning}.`;
      } else if (etaCalculationError) {
        successMsg = `En Route saved and customer notified (fallback ETA used).`;
      } else {
        successMsg = `En Route saved and customer notified. ETA: ${etaMinutes} min${etaDistance ? ` (${etaDistance})` : ''}.`;
      }

      showAlert(successMsg);
      refresh();
    } catch (error: any) {
      console.error('Error sending en route notification:', error);
      showAlert('Failed to send notification: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleArrived() {
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before marking tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }

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

      let arrivedSmsWarning: string | null = null;
      try {
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
        if (!smsResponse.ok) {
          arrivedSmsWarning = 'SMS failed to send';
          console.warn('Arrived SMS failed:', await smsResponse.text());
        }
      } catch (smsError: any) {
        arrivedSmsWarning = 'SMS failed: ' + smsError.message;
        console.warn('Arrived SMS error:', smsError);
      }

      const { error: arrivedUpdateError } = await supabase
        .from('task_status')
        .update({
          status: 'arrived',
          arrived_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      if (arrivedUpdateError) throw new Error('Failed to update task status: ' + arrivedUpdateError.message);

      showAlert(arrivedSmsWarning
        ? `Arrived saved. Warning: ${arrivedSmsWarning}.`
        : 'Arrived and customer notified successfully!');
      refresh();
    } catch (error: any) {
      console.error('Error sending arrival notification:', error);
      showAlert('Failed to send notification: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleImageUpload(isDamage?: boolean) {
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

        const columnName = isDamage ? 'damage_images' : 'delivery_images';

        const { data: currentRow, error: fetchError } = await supabase
          .from('task_status')
          .select(columnName)
          .eq('id', taskStatusId)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const existingUrls: string[] = (currentRow as any)?.[columnName] || [];
        const mergedUrls = [...existingUrls, ...uploadedUrls];

        const { error: updateError } = await supabase
          .from('task_status')
          .update({ [columnName]: mergedUrls })
          .eq('id', taskStatusId);

        if (updateError) throw updateError;

        const photoType = isDamage ? 'damage' : 'delivery';
        showAlert(`${uploadedUrls.length} ${photoType} photo(s) uploaded and saved successfully!`);
        refresh();
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
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }

    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      const pickupTime = task.pickupPreference === 'same_day'
        ? `this evening (${task.eventEndTime || 'after your event'})`
        : 'tomorrow morning';

      let message = `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;

      let dropOffSmsWarning: string | null = null;
      try {
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
              mediaUrls: [],
            }),
          }
        );
        if (!smsResponse.ok) {
          dropOffSmsWarning = 'SMS failed to send';
          console.warn('Drop-off complete SMS failed:', await smsResponse.text());
        }
      } catch (smsError: any) {
        dropOffSmsWarning = 'SMS failed: ' + smsError.message;
        console.warn('Drop-off complete SMS error:', smsError);
      }

      const { error: dropOffUpdateError } = await supabase
        .from('task_status')
        .update({
          status: 'completed',
          completed_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      if (dropOffUpdateError) throw new Error('Failed to update task status: ' + dropOffUpdateError.message);

      showAlert(dropOffSmsWarning
        ? `Delivery marked complete. Warning: ${dropOffSmsWarning}.`
        : 'Delivery completed and customer notified!');
      refresh();
    } catch (error: any) {
      console.error('Error completing delivery:', error);
      showAlert('Failed to complete delivery: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handlePickupComplete() {
    if (!mileageLog || !mileageLog.start_mileage) {
      showAlert('You must enter your starting mileage before completing tasks. Please use the "Start Day Mileage" button in the day view.');
      return;
    }

    setProcessing(true);
    try {
      const taskStatusId = await ensureTaskStatus();

      let pickupSmsWarning: string | null = null;
      try {
        const smsResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              templateKey: 'pickup_thanks_sms',
              orderId: task.orderId,
            }),
          }
        );
        if (!smsResponse.ok) {
          const errorData = await smsResponse.json().catch(() => ({}));
          pickupSmsWarning = errorData.error || 'SMS failed to send';
          console.warn('Pickup complete SMS failed:', errorData);
        }
      } catch (smsError: any) {
        pickupSmsWarning = 'SMS failed: ' + smsError.message;
        console.warn('Pickup complete SMS error:', smsError);
      }

      try {
        const emailResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              templateName: 'pickup_complete',
              orderId: task.orderId,
            }),
          }
        );
        if (!emailResponse.ok) {
          console.warn('Pickup complete email failed (non-blocking)');
        }
      } catch (emailError: any) {
        console.warn('Pickup complete email error (non-blocking):', emailError);
      }

      const { error: pickupUpdateError } = await supabase
        .from('task_status')
        .update({
          status: 'completed',
          completed_time: new Date().toISOString(),
        })
        .eq('id', taskStatusId);

      if (pickupUpdateError) throw new Error('Failed to update task status: ' + pickupUpdateError.message);

      showAlert(pickupSmsWarning
        ? `Pickup marked complete. Warning: ${pickupSmsWarning}.`
        : 'Pickup completed! Thank you message and review request sent.');
      refresh();
    } catch (error: any) {
      console.error('Error completing pickup:', error);
      showAlert('Failed to complete pickup: ' + error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReorder(direction: 'up' | 'down') {
    try {
      const currentIndex = tasksOfSameType.findIndex(t => t.id === task.id);
      if (currentIndex === -1) return;

      const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= tasksOfSameType.length) return;

      const currentTask = tasksOfSameType[currentIndex];
      const swapTask = tasksOfSameType[swapIndex];

      const currentOrder = currentTask.taskStatus?.sortOrder || currentIndex;
      const swapOrder = swapTask.taskStatus?.sortOrder || swapIndex;

      const updates: Promise<{ error: any }>[] = [];

      if (currentTask.taskStatus?.id) {
        updates.push(
          supabase
            .from('task_status')
            .update({ sort_order: swapOrder })
            .eq('id', currentTask.taskStatus.id)
        );
      }

      if (swapTask.taskStatus?.id) {
        updates.push(
          supabase
            .from('task_status')
            .update({ sort_order: currentOrder })
            .eq('id', swapTask.taskStatus.id)
        );
      }

      const results = await Promise.all(updates);
      const reorderError = results.find(r => r.error)?.error;
      if (reorderError) throw new Error('Failed to reorder: ' + reorderError.message);
      showAlert(`Task moved ${direction}`);
      refresh();
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
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          order_id: task.orderId,
          stripe_payment_intent_id: null,
          stripe_charge_id: null,
          amount_cents: amountCents,
          tip_cents: 0,
          status: 'succeeded',
          payment_method: 'cash',
          error_message: null,
        });

      if (paymentError) throw paymentError;

      const { data: order } = await supabase
        .from('orders')
        .select('*, customers(*)')
        .eq('id', task.orderId)
        .single();

      if (order && (order.customers as any)?.email) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: (order.customers as any).email,
            subject: `Payment Received - Order #${task.orderNumber}`,
            text: `Thank you for your payment!\n\nWe have received your cash payment of ${formatCurrency(amountCents)} for order #${task.orderNumber}.\n\nThank you for choosing Bounce Party Club!`,
          }),
        });
      }

      showAlert(`Cash payment of ${formatCurrency(amountCents)} recorded successfully!`);
      setShowCashPayment(false);
      setCashAmount('');
      refresh();
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
      const { error } = await supabase
        .from('order_signatures')
        .insert({
          order_id: task.orderId,
          signature_data_url: 'PAPER_WAIVER_SIGNED_IN_PERSON',
          renter_name: task.customerName || 'Unknown',
          renter_phone: task.customerPhone || '',
          renter_email: task.customerEmail || null,
          ip_address: '0.0.0.0',
          user_agent: 'Admin Paper Waiver',
        });

      if (error) throw error;

      showAlert('Waiver marked as signed in person!');
      refresh();
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

    const shouldRefund = await showConfirm(
      `Would you like to issue a full refund to ${task.customerName}?\n\nClick OK to issue refund, or Cancel to skip refund.`
    );

    const finalConfirm = await showConfirm(
      `Cancel order #${task.orderNumber} for ${task.customerName}?\n\nReason: ${cancelReason}\n${shouldRefund ? '\n✓ Full refund will be issued' : '\n✗ No refund will be issued'}\n\nCustomer will be notified via SMS.`
    );

    if (!finalConfirm) return;

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
            adminOverrideRefund: shouldRefund,
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
    navigate(`/admin?tab=orders&subtab=single_order&orderId=${task.orderId}`);
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
  const isFuture = taskDate.getTime() > today.getTime();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-2 sm:my-4 mx-2 sm:mx-4 max-h-[calc(100vh-16px)] sm:max-h-[95vh] overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 z-10 flex-shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-sm mb-3 -ml-1 px-1 py-1 hover:bg-blue-50 rounded-lg transition-colors"
              title="Back to day view"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to day view</span>
            </button>
          )}
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h2 className="text-lg sm:text-2xl font-bold text-slate-900">
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
