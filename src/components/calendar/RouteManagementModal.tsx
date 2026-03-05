import { useState } from 'react';
import { X, GripVertical, Route as RouteIcon, Shuffle, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [reordering, setReordering] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const sortedTasks = [...tasks]
    .filter(t => t.type === type)
    .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));

  async function moveTask(fromIndex: number, direction: 'up' | 'down') {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= sortedTasks.length) return;
    await handleReorder(fromIndex, toIndex);
  }

  async function handleReorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;

    setReordering(true);
    try {
      const reorderedTasks = [...sortedTasks];
      const [movedTask] = reorderedTasks.splice(fromIndex, 1);
      reorderedTasks.splice(toIndex, 0, movedTask);

      const updates = reorderedTasks.map((task, index) => {
        if (!task.taskStatus?.id) return null;
        return supabase
          .from('task_status')
          .update({ sort_order: index })
          .eq('id', task.taskStatus.id);
      }).filter(Boolean);

      await Promise.all(updates);
      showToast('Route updated successfully', 'success');
      onUpdate();
    } catch (error: any) {
      console.error('Error reordering route:', error);
      showToast('Failed to reorder route', 'error');
    } finally {
      setReordering(false);
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
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex flex-col gap-3 mb-4">
            <p className="text-sm text-slate-600">
              Use arrow buttons or drag items to reorder stops manually, or use auto-optimization
            </p>
            <button
              onClick={() => {
                onOptimize();
                onClose();
              }}
              disabled={reordering || optimizing}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Shuffle className="w-4 h-4" />
              {optimizing ? 'Optimizing Route...' : 'Auto-Optimize Route'}
            </button>
          </div>

          <div className="space-y-2">
            {sortedTasks.map((task, index) => (
              <div
                key={task.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                className={`bg-slate-50 border-2 border-slate-200 rounded-lg p-3 sm:p-4 hover:border-blue-400 transition-colors ${
                  draggedIndex === index ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <div className="hidden sm:block">
                    <GripVertical className="w-5 h-5 text-slate-400 mt-1 flex-shrink-0 cursor-move" />
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
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => moveTask(index, 'up')}
                      disabled={index === 0 || reordering}
                      className="p-1.5 hover:bg-blue-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move up"
                    >
                      <ChevronUp className="w-5 h-5 text-slate-600" />
                    </button>
                    <button
                      onClick={() => moveTask(index, 'down')}
                      disabled={index === sortedTasks.length - 1 || reordering}
                      className="p-1.5 hover:bg-blue-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move down"
                    >
                      <ChevronDown className="w-5 h-5 text-slate-600" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {sortedTasks.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              No tasks for this route type
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
