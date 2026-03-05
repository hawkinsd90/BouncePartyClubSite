import { useState } from 'react';
import { X, GripVertical, Route as RouteIcon, Shuffle } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface RouteManagementModalProps {
  isOpen: boolean;
  tasks: Task[];
  type: 'drop-off' | 'pick-up';
  onClose: () => void;
  onUpdate: () => void;
  onOptimize: () => void;
  optimizing?: boolean;
}

export function RouteManagementModal({
  isOpen,
  tasks,
  type,
  onClose,
  onUpdate,
  onOptimize,
  optimizing = false,
}: RouteManagementModalProps) {
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchCurrentY, setTouchCurrentY] = useState<number | null>(null);

  const sortedTasks = [...tasks]
    .filter(t => t.type === type)
    .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));

  const [localTasks, setLocalTasks] = useState(sortedTasks);

  if (!isOpen) return null;


  function handleReorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;

    const reorderedTasks = [...localTasks];
    const [movedTask] = reorderedTasks.splice(fromIndex, 1);
    reorderedTasks.splice(toIndex, 0, movedTask);

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

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (draggedIndex === null) return;
    handleReorder(draggedIndex, toIndex);
    setDraggedIndex(null);
  }

  function handleTouchStart(e: React.TouchEvent, index: number) {
    setDraggedIndex(index);
    setTouchStartY(e.touches[0].clientY);
    setTouchCurrentY(e.touches[0].clientY);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (draggedIndex === null || touchStartY === null) return;
    setTouchCurrentY(e.touches[0].clientY);
  }

  function handleTouchEnd(e: React.TouchEvent, dropIndex: number) {
    if (draggedIndex === null) return;

    // Only reorder if the touch moved significantly and ended on a different item
    if (draggedIndex !== dropIndex) {
      handleReorder(draggedIndex, dropIndex);
    }

    setDraggedIndex(null);
    setTouchStartY(null);
    setTouchCurrentY(null);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <RouteIcon className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">
              Manage {type === 'drop-off' ? 'Delivery' : 'Pickup'} Route
            </h2>
          </div>
          <button
            onClick={() => {
              if (hasChanges) {
                if (confirm('You have unsaved changes. Are you sure you want to close?')) {
                  setHasChanges(false);
                  setLocalTasks(sortedTasks);
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
              Drag items to reorder stops manually, or use auto-optimization
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
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onTouchStart={(e) => handleTouchStart(e, index)}
                onTouchMove={(e) => handleTouchMove(e)}
                onTouchEnd={(e) => handleTouchEnd(e, index)}
                className={`bg-slate-50 border-2 border-slate-200 rounded-lg p-3 sm:p-4 hover:border-blue-400 transition-all ${
                  draggedIndex === index ? 'opacity-50 scale-105 shadow-lg border-blue-500' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <div className="flex-shrink-0">
                    <GripVertical className="w-5 h-5 text-slate-400 mt-1 cursor-grab active:cursor-grabbing" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-600 text-white font-bold rounded-full text-sm flex-shrink-0">
                        {index + 1}
                      </span>
                      <h3 className="font-semibold text-slate-900 truncate">
                        {task.customerName}
                      </h3>
                    </div>
                    <p className="text-sm text-slate-600 truncate">
                      {task.address}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {task.eventStartTime} - {task.eventEndTime}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {localTasks.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No tasks for this route type
            </div>
          )}

          {hasChanges && (
            <div className="sticky bottom-0 pt-4 pb-2 bg-white border-t border-slate-200 -mx-6 px-6">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setLocalTasks(sortedTasks);
                    setHasChanges(false);
                  }}
                  disabled={saving}
                  className="flex-1 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  Cancel Changes
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Route'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
