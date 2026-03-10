import { useState } from 'react';
import { optimizeMorningRoute, type MorningRouteStop } from '../lib/routeOptimization';
import { Task } from './useCalendarTasks';

export function useRouteOptimization() {
  const [optimizing, setOptimizing] = useState(false);

  async function optimizeRoute(tasks: Task[]): Promise<Task[]> {
    setOptimizing(true);
    try {
      if (tasks.length < 2) {
        throw new Error('Need at least 2 stops to optimize the route');
      }

      const routeStops: MorningRouteStop[] = tasks.map(task => ({
        id: task.taskStatus?.id || '',
        taskId: task.id,
        orderId: task.orderId,
        address: task.address,
        type: task.type,
        eventStartTime: task.type === 'drop-off' ? task.eventStartTime : task.eventEndTime,
        equipmentIds: task.equipmentIds,
        numInflatables: task.numInflatables,
      }));

      const optimizedStops = await optimizeMorningRoute(routeStops);

      // Map optimized stops back to tasks in the new order
      const optimizedTasks = optimizedStops.map(stop => {
        const task = tasks.find(t => t.id === stop.taskId);
        if (!task) throw new Error('Task not found');
        return task;
      });

      return optimizedTasks;
    } catch (error) {
      console.error('Error optimizing route:', error);
      throw error;
    } finally {
      setOptimizing(false);
    }
  }

  return {
    optimizing,
    optimizeRoute,
  };
}
