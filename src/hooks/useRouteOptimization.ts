import { useState } from 'react';
import { optimizeMorningRoute, type MorningRouteStop, type RouteOriginOptions } from '../lib/routeOptimization';
import { Task } from './useCalendarTasks';

export function useRouteOptimization() {
  const [optimizing, setOptimizing] = useState(false);

  async function optimizeRoute(tasks: Task[], originOverride?: RouteOriginOptions): Promise<Task[]> {
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
        routeDateISO: task.date.toISOString().split('T')[0],
        lat: task.lat,
        lng: task.lng,
      }));

      const stopsWithCoords = routeStops.filter(s => s.lat != null && s.lng != null).length;
      // console.log(`[useRouteOptimization] ${stopsWithCoords}/${routeStops.length} stops have lat/lng coords`);

      if (originOverride) {
        // console.log(`[useRouteOptimization] Start mode: custom origin "${originOverride.label}" → ${originOverride.address}`);
      } else {
        // console.log('[useRouteOptimization] Start mode: Home Base (default)');
      }

      const optimizedStops = await optimizeMorningRoute(routeStops, originOverride);

      // console.log('[useRouteOptimization] Optimized stops order:',
      //   optimizedStops.map((s, i) => `${i + 1}. ${s.address}`).join('\n'));

      const optimizedTasks = optimizedStops.map((stop, index) => {
        const task = tasks.find(t => t.id === stop.taskId);
        if (!task) throw new Error('Task not found');
        // console.log(`[useRouteOptimization] Position ${index + 1}: ${task.customerName} at ${task.address}`);
        return task;
      });

      // console.log('[useRouteOptimization] Final optimized tasks order:',
      //   optimizedTasks.map((t, i) => `${i + 1}. ${t.customerName}`).join(', '));

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
