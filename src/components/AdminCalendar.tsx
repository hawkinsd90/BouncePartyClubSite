import { useState, useEffect, useRef } from 'react';
import { TaskDetailModal } from './admin/TaskDetailModal';
import { CalendarHeader } from './calendar/CalendarHeader';
import { CalendarGrid } from './calendar/CalendarGrid';
import { DayViewModal } from './calendar/DayViewModal';
import { MileageModal } from './calendar/MileageModal';
import { useCalendarTasks, Task } from '../hooks/useCalendarTasks';
import { useRouteOptimization } from '../hooks/useRouteOptimization';
import { getTasksForDate } from '../lib/calendarUtils';
import { format, parse, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';

export function AdminCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showMileageModal, setShowMileageModal] = useState(false);
  const pendingTaskIdRef = useRef<string | null>(null);

  const { tasks, loading, reload } = useCalendarTasks(currentMonth);
  const { optimizing, optimizeRoute } = useRouteOptimization();
  const [mileageDates, setMileageDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadMonthMileage();
  }, [currentMonth]);

  async function loadMonthMileage() {
    try {
      const start = startOfMonth(currentMonth).toISOString().split('T')[0];
      const end = endOfMonth(currentMonth).toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_mileage_logs')
        .select('date')
        .gte('date', start)
        .lte('date', end);
      if (data) {
        setMileageDates(new Set(data.map(r => r.date as string)));
      }
    } catch {
      // Non-critical
    }
  }

  // Load date and taskId from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    const taskIdParam = params.get('taskId');

    if (dateParam) {
      try {
        const date = parse(dateParam, 'yyyy-MM-dd', new Date());
        setSelectedDate(date);
        if (taskIdParam) {
          pendingTaskIdRef.current = taskIdParam;
        } else {
          setShowDayModal(true);
        }
      } catch (error) {
        console.error('Invalid date in URL:', error);
      }
    }
  }, []);

  // Once tasks load, restore pending task from URL
  useEffect(() => {
    if (!loading && pendingTaskIdRef.current && tasks.length > 0) {
      const taskId = pendingTaskIdRef.current;
      pendingTaskIdRef.current = null;
      const found = tasks.find(t => t.id === taskId);
      if (found) {
        setSelectedTask(found);
      } else {
        setShowDayModal(true);
      }
    }
  }, [loading, tasks]);

  // Update URL when date or task changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (selectedTask) {
      if (selectedDate) params.set('date', format(selectedDate, 'yyyy-MM-dd'));
      params.set('taskId', selectedTask.id);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    } else if (selectedDate && showDayModal) {
      params.set('date', format(selectedDate, 'yyyy-MM-dd'));
      params.delete('taskId');
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    } else if (!showDayModal && !selectedTask) {
      params.delete('date');
      params.delete('taskId');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [selectedDate, showDayModal, selectedTask]);

  function handleDateClick(date: Date) {
    setSelectedDate(date);
    setShowDayModal(true);
  }

  function handleTaskClick(task: Task) {
    setSelectedTask(task);
    setShowDayModal(false);
  }

  function handleBackToDayView() {
    setSelectedTask(null);
    setShowDayModal(true);
  }

  function handleTaskRefresh() {
    reload();
  }

  const selectedDayTasks = selectedDate ? getTasksForDate(tasks, selectedDate) : [];

  // Keep selectedTask in sync with freshly loaded tasks
  const liveTask = selectedTask
    ? (tasks.find(t => t.id === selectedTask.id) ?? selectedTask)
    : null;

  return (
    <div className="space-y-6">
      <CalendarHeader currentMonth={currentMonth} onMonthChange={setCurrentMonth} />

      <CalendarGrid currentMonth={currentMonth} tasks={tasks} onDateClick={handleDateClick} mileageDates={mileageDates} />

      {showDayModal && selectedDate && (
        <DayViewModal
          selectedDate={selectedDate}
          tasks={selectedDayTasks}
          optimizing={optimizing}
          onClose={() => setShowDayModal(false)}
          onTaskClick={handleTaskClick}
          onOptimizeRoute={optimizeRoute}
          onRefresh={reload}
        />
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-slate-600">Loading calendar...</p>
        </div>
      )}

      <MileageModal
        isOpen={showMileageModal}
        date={selectedDate || new Date()}
        type="start"
        onClose={() => setShowMileageModal(false)}
        onSuccess={() => { setShowMileageModal(false); reload(); }}
      />

      {liveTask && (
        <TaskDetailModal
          task={liveTask}
          allTasks={getTasksForDate(tasks, liveTask.date)}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            setSelectedTask(null);
            reload();
          }}
          onRefresh={handleTaskRefresh}
          onBack={selectedDate ? handleBackToDayView : undefined}
          onOpenMileageModal={() => setShowMileageModal(true)}
        />
      )}
    </div>
  );
}
