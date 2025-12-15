import { isSameDay } from 'date-fns';
import { Task } from '../hooks/useCalendarTasks';

export function getTasksForDate(tasks: Task[], date: Date): Task[] {
  return tasks.filter(task => isSameDay(task.date, date));
}

export function getStopNumber(task: Task, selectedDayTasks: Task[]): number {
  const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off');
  const morningPickUpTasks = selectedDayTasks.filter(t => t.type === 'pick-up' && t.pickupPreference === 'next_day');
  const afternoonPickUpTasks = selectedDayTasks.filter(t => t.type === 'pick-up' && t.pickupPreference === 'same_day');

  if (task.type === 'drop-off') {
    const morningTasks = [...dropOffTasks, ...morningPickUpTasks]
      .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));
    return morningTasks.findIndex(t => t.id === task.id) + 1;
  } else if (task.type === 'pick-up' && task.pickupPreference === 'next_day') {
    const morningTasks = [...dropOffTasks, ...morningPickUpTasks]
      .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));
    return morningTasks.findIndex(t => t.id === task.id) + 1;
  } else if (task.type === 'pick-up' && task.pickupPreference === 'same_day') {
    const afternoonTasks = afternoonPickUpTasks
      .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0));
    return afternoonTasks.findIndex(t => t.id === task.id) + 1;
  }
  return 0;
}
