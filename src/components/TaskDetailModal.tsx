import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Navigation, CheckCircle, Camera, MessageCircle, Upload, ChevronUp, ChevronDown, Star, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatCurrency } from '../lib/pricing';
import { showAlert } from './CustomModal';

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
  const currentStatus = task.taskStatus?.status || 'pending';

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

      const eta = new Date(Date.now() + 30 * 60000);
      const etaStart = new Date(eta.getTime() - 10 * 60000);
      const etaEnd = new Date(eta.getTime() + 10 * 60000);
      const timeFormat = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      let message = `Hello ${task.customerName.split(' ')[0]}! We're on our way to ${task.type === 'drop-off' ? 'deliver' : 'pick up'} your rental. `;
      message += `ETA: ${timeFormat(etaStart)} - ${timeFormat(etaEnd)}. `;

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
        })
        .eq('id', taskStatusId);

      showAlert('En route notification sent successfully!');
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
        const existingImages = existingTask.data?.[field] || [];
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

      const pickupTime = task.pickupPreference === 'same_day'
        ? `this evening (${task.eventEndTime || 'after your event'})`
        : 'tomorrow morning';

      const message = `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;

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

  const isDropOff = task.type === 'drop-off';
  const statusColor = {
    pending: 'bg-slate-100 text-slate-800',
    en_route: 'bg-blue-100 text-blue-800',
    arrived: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
  }[currentStatus];

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
            <p className="text-sm text-slate-600">Order #{task.orderNumber}</p>
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

          <div className="border-t border-slate-200 pt-6">
            <h3 className="font-bold text-slate-900 mb-4">Actions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleEnRoute}
                disabled={processing || currentStatus !== 'pending'}
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                <Navigation className="w-5 h-5" />
                <span className="text-sm sm:text-base">En Route</span>
              </button>

              <button
                onClick={handleArrived}
                disabled={processing || currentStatus === 'pending' || currentStatus === 'completed'}
                className="flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
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
                    disabled={processing || currentStatus === 'completed'}
                    className="flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-sm sm:text-base">Left - Send Rules</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handlePickupComplete}
                    disabled={processing || currentStatus === 'completed'}
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
