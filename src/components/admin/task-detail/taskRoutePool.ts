// Route-pool derivation for TaskDetailModal (stop count and the pool the
// move-up/move-down arrows operate on). Extracted verbatim from the modal, where
// the same filter appeared twice. Kept exactly as it was:
// - only active route stops of the same type, preferring those with a saved sort_order;
// - fall back to all active stops of the same type when no route order is saved;
// - the pool is sorted in place by sortOrder ?? 0 (Array.sort is stable, ties keep input order);
// - no other validation, no de-duplication.

import { isTaskActiveRouteStop } from '../../../lib/calendarUtils';
import type { Task } from '../../../hooks/useCalendarTasks';

export function getRoutePool(
  task: Pick<Task, 'type'>,
  allTasks: Task[],
): { activeStopsCount: number; tasksOfSameType: Task[] } {
  const activeRouteStops = allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t) && t.taskStatus?.sortOrder != null
  );
  // Fall back to all active stops of same type when no route order is saved yet
  const activeStopsCount = activeRouteStops.length > 0
    ? activeRouteStops.length
    : allTasks.filter(t => t.type === task.type && isTaskActiveRouteStop(t)).length;

  // Move-up/down arrows operate on the same pool getStopNumber uses: active route stops only,
  // filtered to those with a saved sort_order when the route has been committed to DB.
  const activeRoutePool = allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t) && t.taskStatus?.sortOrder != null
  );
  const tasksOfSameType = (activeRoutePool.length > 0 ? activeRoutePool : allTasks.filter(
    t => t.type === task.type && isTaskActiveRouteStop(t)
  )).sort((a, b) => (a.taskStatus?.sortOrder ?? 0) - (b.taskStatus?.sortOrder ?? 0));

  return { activeStopsCount, tasksOfSameType };
}
