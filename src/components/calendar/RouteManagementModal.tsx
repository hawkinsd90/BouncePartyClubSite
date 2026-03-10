import { useState, useEffect } from 'react';
import { X, Route as RouteIcon, Shuffle, ChevronUp, ChevronDown, Truck, Package } from 'lucide-react';
import { format } from 'date-fns';
import { Task } from '../../hooks/useCalendarTasks';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface RouteManagementModalProps {
  isOpen: boolean;
  tasks: Task[];
  type: 'drop-off' | 'pick-up';
  date: Date;
  onClose: () => void;
  onUpdate: () => void;
  onOptimize: () => void;
  optimizing?: boolean;
}

export function RouteManagementModal({
  isOpen,
  tasks,
  type,
  date,
  onClose,
  onUpdate,
  onOptimize,
  optimizing = false,
}: RouteManagementModalProps) {
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Combine both deliveries and pickups for the same route
  const allRouteTasks = [...tasks]
    .filter(t => {
      // Morning route: deliveries + next-day pickups (pickup happens next morning)
      // Afternoon route: same-day pickups (pickup happens same afternoon/evening)
      if (type === 'drop-off') {
        return t.type === 'drop-off' || (t.type === 'pick-up' && t.pickupPreference === 'next_day');
      }
      return t.type === 'pick-up' && t.pickupPreference === 'same_day';
    })
    .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));

  const [localTasks, setLocalTasks] = useState(allRouteTasks);

  // Update local tasks when modal opens or tasks change
  useEffect(() => {
    if (isOpen) {
      setLocalTasks(allRouteTasks);
      setHasChanges(false);
    }
  }, [isOpen, tasks]);

  if (!isOpen) return null;

  function moveUp(index: number) {
    if (index === 0) return;
    const reorderedTasks = [...localTasks];
    [reorderedTasks[index - 1], reorderedTasks[index]] = [reorderedTasks[index], reorderedTasks[index - 1]];
    setLocalTasks(reorderedTasks);
    setHasChanges(true);
  }

  function moveDown(index: number) {
    if (index === localTasks.length - 1) return;
    const reorderedTasks = [...localTasks];
    [reorderedTasks[index], reorderedTasks[index + 1]] = [reorderedTasks[index + 1], reorderedTasks[index]];
    setLocalTasks(reorderedTasks);
    setHasChanges(true);
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
                if (confirm('You have unsaved changes. Are you sure you want to close?')) {
                  setHasChanges(false);
                  setLocalTasks(allRouteTasks);
                  onClose();
                }
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
          <div className="flex flex-col gap-3 mb-4">
            <p className="text-sm text-slate-600">
              Use the up and down arrows to reorder stops, or use auto-optimization
            </p>
            <button
              onClick={onOptimize}
              disabled={saving || optimizing}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Shuffle className="w-4 h-4" />
              {optimizing ? 'Optimizing Route...' : 'Auto-Optimize Route'}
            </button>
          </div>

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

                    {/* Equipment List */}
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

          <div className="flex gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={() => {
                setLocalTasks(allRouteTasks);
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
    </div>
  );
}
