import { useState, useEffect } from 'react';
import { TaskDetailModal } from './admin/TaskDetailModal';
import { CalendarHeader } from './calendar/CalendarHeader';
import { CalendarGrid } from './calendar/CalendarGrid';
import { DayViewModal } from './calendar/DayViewModal';
import { MileageModal } from './calendar/MileageModal';
import { useCalendarTasks, Task } from '../hooks/useCalendarTasks';
import { useRouteOptimization } from '../hooks/useRouteOptimization';
import { getTasksForDate } from '../lib/calendarUtils';
import { format, parse } from 'date-fns';

export function AdminCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showMileageModal, setShowMileageModal] = useState(false);

  const { tasks, loading, reload } = useCalendarTasks(currentMonth);
  const { optimizing, optimizeRoute } = useRouteOptimization();

  // Load date from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam) {
      try {
        const date = parse(dateParam, 'yyyy-MM-dd', new Date());
        setSelectedDate(date);
        setShowDayModal(true);
      } catch (error) {
        console.error('Invalid date in URL:', error);
      }
    }
  }, []);

  // Update URL when date is selected
  useEffect(() => {
    if (selectedDate && showDayModal) {
      const params = new URLSearchParams(window.location.search);
      params.set('date', format(selectedDate, 'yyyy-MM-dd'));
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    } else if (!showDayModal) {
      // Remove date param when modal is closed
      const params = new URLSearchParams(window.location.search);
      params.delete('date');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [selectedDate, showDayModal]);

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

  const selectedDayTasks = selectedDate ? getTasksForDate(tasks, selectedDate) : [];

  return (
    <div className="space-y-6">
      <CalendarHeader currentMonth={currentMonth} onMonthChange={setCurrentMonth} />

      <CalendarGrid currentMonth={currentMonth} tasks={tasks} onDateClick={handleDateClick} />

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

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          allTasks={getTasksForDate(tasks, selectedTask.date)}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            setSelectedTask(null);
            reload();
          }}
          onBack={selectedDate ? handleBackToDayView : undefined}
          onOpenMileageModal={() => setShowMileageModal(true)}
        />
      )}
    </div>
  );
}
