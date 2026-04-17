import { isSameDay } from 'date-fns';
import { Task } from '../hooks/useCalendarTasks';
import { ORDER_STATUS } from './constants/statuses';

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
      // If sortOrder is the same, prioritize deliveries over pickups
      if (orderA === orderB) {
        if (a.type === 'drop-off' && b.type === 'pick-up') return -1;
        if (a.type === 'pick-up' && b.type === 'drop-off') return 1;
        // If same type and same sortOrder, use event times
        const timeA = a.type === 'drop-off' ? a.eventStartTime : a.eventEndTime;
        const timeB = b.type === 'drop-off' ? b.eventStartTime : b.eventEndTime;
        return timeA.localeCompare(timeB);
      }
      return orderA - orderB;
    }

    // If only one has sortOrder, prioritize it
    if (orderA !== undefined && orderA !== null) return -1;
    if (orderB !== undefined && orderB !== null) return 1;

    // If neither has sortOrder, prioritize deliveries over pickups, then sort by event times
    if (a.type === 'drop-off' && b.type === 'pick-up') return -1;
    if (a.type === 'pick-up' && b.type === 'drop-off') return 1;

    const timeA = a.type === 'drop-off' ? a.eventStartTime : a.eventEndTime;
    const timeB = b.type === 'drop-off' ? b.eventStartTime : b.eventEndTime;
    return timeA.localeCompare(timeB);
  });
}

export function isDropOffPlanningOnly(task: Task): boolean {
  return task.type === 'drop-off' && task.status === ORDER_STATUS.PENDING;
}

export function isTaskActiveRouteStop(task: Task): boolean {
  if (task.type === 'drop-off') {
    // pending_review orders are unconfirmed — visible for planning but not actionable
    if (task.status === ORDER_STATUS.PENDING) return false;
    return task.taskStatus?.status !== 'completed';
  }
  return task.pickupReadiness === 'ready';
}

export function getStopNumber(task: Task, selectedDayTasks: Task[]): number {
  const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off' && isTaskActiveRouteStop(t));
  const morningPickUpTasks = selectedDayTasks.filter(
    t => t.type === 'pick-up' && t.pickupPreference === 'next_day' && isTaskActiveRouteStop(t)
  );
  const afternoonPickUpTasks = selectedDayTasks.filter(
    t => t.type === 'pick-up' && t.pickupPreference === 'same_day' && isTaskActiveRouteStop(t)
  );

  if (!isTaskActiveRouteStop(task)) return 0;

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
