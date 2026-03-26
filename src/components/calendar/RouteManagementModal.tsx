import { useState, useEffect, useMemo } from 'react';
import { X, Route as RouteIcon, Shuffle, ChevronUp, ChevronDown, Truck, Package, AlertTriangle, Clock, CheckCircle, Home, MapPin, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { Task } from '../../hooks/useCalendarTasks';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { sortTasksByOrder, isTaskActiveRouteStop, isDropOffPlanningOnly } from '../../lib/calendarUtils';
import { SimpleConfirmModal } from '../common/SimpleConfirmModal';
import type { RouteOriginOptions } from '../../lib/routeOptimization';

export type RouteStartMode = 'home_base' | 'last_completed' | 'current_location';

interface RouteManagementModalProps {
  isOpen: boolean;
  tasks: Task[];
  type: 'drop-off' | 'pick-up';
  date: Date;
  onClose: () => void;
  onUpdate: () => void;
  onOptimizeRoute: (tasks: Task[], origin?: RouteOriginOptions) => Promise<Task[]>;
  optimizing?: boolean;
}

/**
 * Returns the most recently completed task based on actual completed_time timestamp.
 * Falls back to sort order if completed_time is unavailable (legacy records).
 */
function deriveLastCompletedTask(completedTasks: Task[]): Task | null {
  if (completedTasks.length === 0) return null;

  const withTime = completedTasks.filter(t => t.taskStatus?.completedTime);
  if (withTime.length > 0) {
    return withTime.reduce((latest, t) => {
      const latestMs = new Date(latest.taskStatus!.completedTime!).getTime();
      const candidateMs = new Date(t.taskStatus!.completedTime!).getTime();
      return candidateMs > latestMs ? t : latest;
    });
  }

  // Fallback: use sort order (highest = completed last in route)
  const withSortOrder = completedTasks.filter(t => t.taskStatus?.sortOrder != null);
  if (withSortOrder.length > 0) {
    return withSortOrder.reduce((latest, t) =>
      (t.taskStatus!.sortOrder! > latest.taskStatus!.sortOrder!) ? t : latest
    );
  }

  return completedTasks[completedTasks.length - 1];
}

export function RouteManagementModal({
  isOpen,
  tasks,
  type,
  date,
  onClose,
  onUpdate,
  onOptimizeRoute,
  optimizing = false,
}: RouteManagementModalProps) {
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [initialTasks, setInitialTasks] = useState<Task[]>([]);
  const [initialOrder, setInitialOrder] = useState<string[]>([]);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [modalJustOpened, setModalJustOpened] = useState(false);
  const [startMode, setStartMode] = useState<RouteStartMode>('home_base');
  const [resolvedOriginLabel, setResolvedOriginLabel] = useState<string | null>(null);

  const allRouteTypeTasks = useMemo(() => tasks.filter(t => {
    if (type === 'drop-off') {
      return t.type === 'drop-off' || (t.type === 'pick-up' && t.pickupPreference === 'next_day');
    }
    return t.type === 'pick-up' && t.pickupPreference === 'same_day';
  }), [tasks, type]);

  const completedTasks = useMemo(() =>
    allRouteTypeTasks.filter(
      t => t.taskStatus?.status === 'completed' || (t.type === 'pick-up' && t.pickupReadiness === 'completed')
    ),
    [allRouteTypeTasks]
  );

  const lastCompletedTask = useMemo(() => deriveLastCompletedTask(completedTasks), [completedTasks]);

  // Dynamic default: use last_completed if a completed stop exists, otherwise home_base.
  // Only runs when the modal first opens or completed tasks change while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const defaultMode: RouteStartMode = lastCompletedTask ? 'last_completed' : 'home_base';
    setStartMode(prev => {
      // Only override if current selection is disabled (no completed stops but last_completed selected)
      if (prev === 'last_completed' && !lastCompletedTask) return 'home_base';
      // On first open, use the smart default
      if (!modalJustOpened) return defaultMode;
      return prev;
    });
  }, [isOpen, lastCompletedTask, modalJustOpened]);

  useEffect(() => {
    if (isOpen && !modalJustOpened) {
      setModalJustOpened(true);

      const allRouteTasks = sortTasksByOrder(allRouteTypeTasks);
      const eligibleTasks = allRouteTasks.filter(t => isTaskActiveRouteStop(t));

      setLocalTasks(eligibleTasks);
      setInitialTasks(eligibleTasks);
      setInitialOrder(eligibleTasks.map(t => t.id));
      setHasChanges(false);
      setResolvedOriginLabel(null);
    } else if (isOpen && modalJustOpened && !hasChanges) {
      const allRouteTasks = sortTasksByOrder(allRouteTypeTasks);
      const eligibleTasks = allRouteTasks.filter(t => isTaskActiveRouteStop(t));

      setLocalTasks(eligibleTasks);
      setInitialTasks(eligibleTasks);
      setInitialOrder(eligibleTasks.map(t => t.id));
    } else if (!isOpen && modalJustOpened) {
      setModalJustOpened(false);
      setResolvedOriginLabel(null);
    }
  }, [isOpen, allRouteTypeTasks, modalJustOpened, hasChanges]);

  if (!isOpen) return null;

  const projectedTasks = allRouteTypeTasks.filter(
    t => t.type === 'pick-up' && t.pickupReadiness === 'projected'
  );
  const blockedTasks = allRouteTypeTasks.filter(
    t => t.type === 'pick-up' && t.pickupReadiness === 'blocked'
  );
  const planningOnlyDropOffs = allRouteTypeTasks.filter(t => isDropOffPlanningOnly(t));

  function checkForChanges(newTasks: Task[]) {
    const newOrder = newTasks.map(t => t.id);
    const hasOrderChanged = JSON.stringify(newOrder) !== JSON.stringify(initialOrder);
    setHasChanges(hasOrderChanged);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const reorderedTasks = [...localTasks];
    [reorderedTasks[index - 1], reorderedTasks[index]] = [reorderedTasks[index], reorderedTasks[index - 1]];
    setLocalTasks(reorderedTasks);
    checkForChanges(reorderedTasks);
  }

  function moveDown(index: number) {
    if (index === localTasks.length - 1) return;
    const reorderedTasks = [...localTasks];
    [reorderedTasks[index], reorderedTasks[index + 1]] = [reorderedTasks[index + 1], reorderedTasks[index]];
    setLocalTasks(reorderedTasks);
    checkForChanges(reorderedTasks);
  }

  async function resolveOrigin(): Promise<{ origin: RouteOriginOptions | undefined; label: string; fallback: boolean }> {
    if (startMode === 'home_base') {
      // console.log('[Route Start Mode] Selected: Home Base — no override, optimizer uses home base as matrix row 0');
      return { origin: undefined, label: 'Home Base', fallback: false };
    }

    if (startMode === 'last_completed') {
      if (lastCompletedTask) {
        const ts = lastCompletedTask.taskStatus?.completedTime;
        const timestampInfo = ts
          ? `completed_time=${ts}`
          : 'completed_time=null (using sort order fallback)';
        const origin: RouteOriginOptions = {
          address: lastCompletedTask.address,
          label: `Last Completed Stop (${lastCompletedTask.customerName})`,
        };
        // console.log(
        //   `[Route Start Mode] Selected: Last Completed Stop\n` +
        //   `  Customer: ${lastCompletedTask.customerName}\n` +
        //   `  Address: ${lastCompletedTask.address}\n` +
        //   `  ${timestampInfo}`
        // );
        return { origin, label: origin.label, fallback: false };
      }
      // console.log('[Route Start Mode] Last Completed Stop selected but none found — falling back to Home Base');
      return { origin: undefined, label: 'Home Base (fallback: no completed stops)', fallback: true };
    }

    if (startMode === 'current_location') {
      // console.log('[Route Start Mode] Selected: Current Location — requesting browser geolocation...');
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported by this browser'));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 8000,
            maximumAge: 60000,
          });
        });
        const { latitude, longitude } = position.coords;
        // Google Maps Distance Matrix accepts "lat,lng" strings directly as origins/destinations
        const coordsAddress = `${latitude},${longitude}`;
        const origin: RouteOriginOptions = {
          address: coordsAddress,
          label: 'Current Location',
        };
        // console.log(
        //   `[Route Start Mode] Current Location resolved successfully\n` +
        //   `  lat=${latitude.toFixed(5)}, lng=${longitude.toFixed(5)}\n` +
        //   `  Passing to Distance Matrix as: "${coordsAddress}"`
        // );
        return { origin, label: 'Current Location', fallback: false };
      } catch (geoErr: any) {
        console.warn(`[Route Start Mode] Geolocation failed: ${geoErr.message} — checking fallback...`);
        if (lastCompletedTask) {
          const origin: RouteOriginOptions = {
            address: lastCompletedTask.address,
            label: `Last Completed Stop (${lastCompletedTask.customerName})`,
          };
          // console.log(`[Route Start Mode] Fallback to Last Completed Stop: "${lastCompletedTask.address}"`);
          return { origin, label: `${origin.label} (fallback: geolocation denied)`, fallback: true };
        }
        // console.log('[Route Start Mode] No completed stops available — falling back to Home Base');
        return { origin: undefined, label: 'Home Base (fallback: geolocation denied, no completed stops)', fallback: true };
      }
    }

    return { origin: undefined, label: 'Home Base', fallback: false };
  }

  async function handleOptimize() {
    try {
      // Build a local copy of tasks so we never mutate shared parent references.
      // task_status rows that are missing will be created and stored only in this copy.
      const tasksForOptimization = await Promise.all(localTasks.map(async (task) => {
        if (task.taskStatus) return task;

        const { data, error } = await supabase
          .from('task_status')
          .insert({
            order_id: task.orderId,
            task_type: task.type,
            task_date: task.date.toISOString().split('T')[0],
            status: 'pending',
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating task status:', error);
          throw error;
        }

        return {
          ...task,
          taskStatus: {
            id: data.id,
            status: data.status,
            sortOrder: 0,
            completedTime: null,
            deliveryImages: [] as string[],
            damageImages: [] as string[],
            etaSent: false,
          },
        };
      }));

      const { origin, label, fallback } = await resolveOrigin();
      setResolvedOriginLabel(label);

      if (fallback) {
        showToast(`Origin fallback: using ${label}`, 'info');
      }

      const beforeOrder = tasksForOptimization.map(t => t.id).join(',');
      const optimizedTasks = await onOptimizeRoute(tasksForOptimization, origin);
      const afterOrder = optimizedTasks.map(t => t.id).join(',');

      setLocalTasks([...optimizedTasks]);
      checkForChanges(optimizedTasks);

      if (beforeOrder !== afterOrder) {
        showToast('Route optimized successfully', 'success');
      } else {
        showToast('Route is already optimal', 'info');
      }
    } catch (error: any) {
      console.error('Error optimizing route:', error);
      showToast(error.message || 'Failed to optimize route', 'error');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updates = localTasks.map((task, index) => {
        if (!task.taskStatus?.id) return null;
        return supabase
          .from('task_status')
          .update({ sort_order: index })
          .eq('id', task.taskStatus.id);
      }).filter(Boolean);

      await Promise.all(updates);
      showToast('Route saved successfully', 'success');
      setHasChanges(false);
      onUpdate();
      onClose();
    } catch (error: any) {
      console.error('Error saving route:', error);
      showToast('Failed to save route', 'error');
    } finally {
      setSaving(false);
    }
  }

  const startModeOptions: { value: RouteStartMode; label: string; icon: React.ReactNode; sublabel: string; available: boolean }[] = [
    {
      value: 'home_base',
      label: 'Home Base',
      icon: <Home className="w-4 h-4" />,
      sublabel: 'Default departure point',
      available: true,
    },
    {
      value: 'last_completed',
      label: 'Last Completed',
      icon: <CheckCircle className="w-4 h-4" />,
      sublabel: lastCompletedTask ? lastCompletedTask.customerName : 'No completed stops',
      available: !!lastCompletedTask,
    },
    {
      value: 'current_location',
      label: 'Current Location',
      icon: <Navigation className="w-4 h-4" />,
      sublabel: 'Uses browser GPS',
      available: true,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <RouteIcon className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-slate-900">
                Manage {type === 'drop-off' ? 'Morning' : 'Afternoon'} Route
              </h2>
            </div>
            <p className="text-sm text-slate-600 ml-9">
              {format(date, 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <button
            onClick={() => {
              if (hasChanges) {
                setShowCloseConfirm(true);
              } else {
                onClose();
              }
            }}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <div className="flex flex-col gap-3 mb-4">
              <p className="text-sm text-slate-600">
                {localTasks.length > 0
                  ? 'Use the arrows to reorder stops, or use auto-optimization'
                  : 'No actionable stops for this route yet'}
              </p>

              {localTasks.length >= 2 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Route Start Origin
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {startModeOptions.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setStartMode(opt.value);
                          setResolvedOriginLabel(null);
                        }}
                        disabled={!opt.available}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          startMode === opt.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        <span className={startMode === opt.value ? 'text-blue-600' : 'text-slate-400'}>
                          {opt.icon}
                        </span>
                        <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                        <span className="text-[10px] text-slate-400 leading-tight truncate w-full">{opt.sublabel}</span>
                      </button>
                    ))}
                  </div>
                  {resolvedOriginLabel && (
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      Last optimized from: <span className="font-medium text-slate-700 ml-1">{resolvedOriginLabel}</span>
                    </p>
                  )}
                </div>
              )}

              {localTasks.length >= 2 && (
                <button
                  onClick={handleOptimize}
                  disabled={saving || optimizing}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Shuffle className="w-4 h-4" />
                  {optimizing ? 'Optimizing...' : 'Auto-Optimize Route'}
                </button>
              )}
            </div>

            {localTasks.length > 0 ? (
              <div className="space-y-2 px-2">
                {localTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="bg-slate-50 border-2 border-slate-200 rounded-lg p-3 sm:p-4"
                  >
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => moveUp(index)}
                          disabled={index === 0}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move up"
                        >
                          <ChevronUp className="w-5 h-5 text-slate-600" />
                        </button>
                        <button
                          onClick={() => moveDown(index)}
                          disabled={index === localTasks.length - 1}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                        >
                          <ChevronDown className="w-5 h-5 text-slate-600" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600 text-white font-bold rounded-full text-sm flex-shrink-0">
                            {index + 1}
                          </span>
                          {task.type === 'pick-up' ? (
                            <Package className="w-4 h-4 text-orange-600 flex-shrink-0" />
                          ) : (
                            <Truck className="w-4 h-4 text-green-600 flex-shrink-0" />
                          )}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            task.type === 'pick-up' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {task.type === 'pick-up' ? 'PICKUP' : 'DELIVERY'}
                          </span>
                        </div>
                        <h3 className="font-semibold text-slate-900 text-sm mb-1">
                          {task.customerName}
                        </h3>
                        <p className="text-sm text-slate-600 truncate mb-2">{task.address}</p>
                        {task.items && task.items.length > 0 && (
                          <div className="bg-white border border-slate-200 rounded p-2 mb-2">
                            <p className="text-xs font-semibold text-slate-700 mb-1">Equipment:</p>
                            <ul className="text-xs text-slate-600 space-y-0.5">
                              {task.items.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-xs text-slate-500">
                          Event: {task.eventStartTime} - {task.eventEndTime}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-lg">
                No active route stops
              </div>
            )}
          </div>

          {completedTasks.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Completed ({completedTasks.length})
              </h3>
              <div className="space-y-2">
                {completedTasks.map(task => (
                  <div key={task.id} className="bg-green-50 border border-green-200 rounded-lg p-3 opacity-70">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-slate-700">{task.customerName}</span>
                        <p className="text-xs text-slate-500 truncate">{task.address}</p>
                      </div>
                      <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded">
                        DONE
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {blockedTasks.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Blocked Pickups — Not in Route ({blockedTasks.length})
              </h3>
              <p className="text-xs text-slate-500 mb-3">These pickups cannot proceed until the block is resolved.</p>
              <div className="space-y-2">
                {blockedTasks.map(task => (
                  <div key={task.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-slate-800">{task.customerName}</span>
                        <p className="text-xs text-slate-500 truncate mb-1">{task.address}</p>
                        {task.pickupBlockReason && (
                          <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                            {task.pickupBlockReason}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {projectedTasks.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-500 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Projected Pickups — Planning Only ({projectedTasks.length})
              </h3>
              <p className="text-xs text-slate-500 mb-3">These pickups are not actionable yet.</p>
              <div className="space-y-2">
                {projectedTasks.map(task => (
                  <div key={task.id} className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 opacity-70">
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-slate-600">{task.customerName}</span>
                        <p className="text-xs text-slate-400 truncate mb-1">{task.address}</p>
                        {task.pickupBlockReason && (
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            {task.pickupBlockReason}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {planningOnlyDropOffs.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-500 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Pending Review — Planning Only ({planningOnlyDropOffs.length})
              </h3>
              <p className="text-xs text-slate-500 mb-3">These orders are awaiting confirmation and are not included in the active route.</p>
              <div className="space-y-2">
                {planningOnlyDropOffs.map(task => (
                  <div key={task.id} className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 opacity-70">
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-slate-600">{task.customerName}</span>
                        <p className="text-xs text-slate-400 truncate mb-1">{task.address}</p>
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          Awaiting confirmation
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => {
                setLocalTasks(initialTasks);
                setHasChanges(false);
                onClose();
              }}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Route'}
            </button>
          </div>
        </div>
      </div>

      <SimpleConfirmModal
        isOpen={showCloseConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to close without saving?"
        onConfirm={() => {
          setShowCloseConfirm(false);
          setHasChanges(false);
          setLocalTasks(initialTasks);
          setModalJustOpened(false);
          onClose();
        }}
        onClose={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}
