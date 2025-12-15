import { useState } from 'react';
import { TaskDetailModal } from './TaskDetailModal';
import { CalendarHeader } from './calendar/CalendarHeader';
import { CalendarGrid } from './calendar/CalendarGrid';
import { DayViewModal } from './calendar/DayViewModal';
import { useCalendarTasks, Task } from '../hooks/useCalendarTasks';
import { useRouteOptimization } from '../hooks/useRouteOptimization';
import { getTasksForDate } from '../lib/calendarUtils';

export function AdminCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { tasks, loading, reload } = useCalendarTasks(currentMonth);
  const { optimizing, optimizeMorningRouteForDay, optimizeAfternoonRouteForDay } = useRouteOptimization();

  function handleDateClick(date: Date) {
    setSelectedDate(date);
    setShowDayModal(true);
  }

  function handleTaskClick(task: Task) {
    setSelectedTask(task);
    setShowDayModal(false);
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
          onOptimizeMorning={() => optimizeMorningRouteForDay(selectedDate, selectedDayTasks, reload)}
          onOptimizeAfternoon={() => optimizeAfternoonRouteForDay(selectedDate, selectedDayTasks, reload)}
        />
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-slate-600">Loading calendar...</p>
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          allTasks={getTasksForDate(tasks, selectedTask.date)}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            setSelectedTask(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
