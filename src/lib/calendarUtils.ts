import { isSameDay } from 'date-fns';
import { Task } from '../hooks/useCalendarTasks';

export function getTasksForDate(tasks: Task[], date: Date): Task[] {
  return tasks.filter(task => isSameDay(task.date, date));
}

/**
 * Sorts tasks consistently across the entire application.
 * This MUST be used everywhere tasks are displayed or ordered.
 */
export function sortTasksByOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const orderA = a.taskStatus?.sortOrder;
    const orderB = b.taskStatus?.sortOrder;

    // If both have sortOrder, use it
    if (orderA !== undefined && orderA !== null && orderB !== undefined && orderB !== null) {
      return orderA - orderB;
    }

    // If only one has sortOrder, prioritize it
    if (orderA !== undefined && orderA !== null) return -1;
    if (orderB !== undefined && orderB !== null) return 1;

    // If neither has sortOrder, sort by event start time for deliveries, end time for pickups
    const timeA = a.type === 'drop-off' ? a.eventStartTime : a.eventEndTime;
    const timeB = b.type === 'drop-off' ? b.eventStartTime : b.eventEndTime;
    return timeA.localeCompare(timeB);
  });
}

export function getStopNumber(task: Task, selectedDayTasks: Task[]): number {
  const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off');
  const morningPickUpTasks = selectedDayTasks.filter(t => t.type === 'pick-up' && t.pickupPreference === 'next_day');
  const afternoonPickUpTasks = selectedDayTasks.filter(t => t.type === 'pick-up' && t.pickupPreference === 'same_day');

  if (task.type === 'drop-off') {
    const morningTasks = sortTasksByOrder([...dropOffTasks, ...morningPickUpTasks]);
    return morningTasks.findIndex(t => t.id === task.id) + 1;
  } else if (task.type === 'pick-up' && task.pickupPreference === 'next_day') {
    const morningTasks = sortTasksByOrder([...dropOffTasks, ...morningPickUpTasks]);
    return morningTasks.findIndex(t => t.id === task.id) + 1;
  } else if (task.type === 'pick-up' && task.pickupPreference === 'same_day') {
    const afternoonTasks = sortTasksByOrder(afternoonPickUpTasks);
    return afternoonTasks.findIndex(t => t.id === task.id) + 1;
  }
  return 0;
}
