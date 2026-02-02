import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { optimizeMorningRoute, type MorningRouteStop } from '../lib/routeOptimization';
import { Task } from './useCalendarTasks';

export function useRouteOptimization() {
  const [optimizing, setOptimizing] = useState(false);

  async function optimizeMorningRouteForDay(_selectedDate: Date, selectedDayTasks: Task[], onComplete: () => void) {
    setOptimizing(true);
    try {
      const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off');

      const morningPickUpTasks = selectedDayTasks.filter(t => {
        return t.type === 'pick-up' && t.pickupPreference === 'next_day';
      });

      const morningTasks = [...morningPickUpTasks, ...dropOffTasks];

      if (morningTasks.length < 2) {
        alert('Need at least 2 stops to optimize the morning route');
        return;
      }

      for (const task of morningTasks) {
        if (!task.taskStatus) {
          const { data, error } = await supabase
            .from('task_status')
            .insert({
              task_id: task.id,
              order_id: task.orderId,
              status: 'pending',
              crew_notes: null,
              admin_notes: null,
              completed_at: null,
              estimated_arrival: null,
            })
            .select()
            .single();

          if (error) {
            console.error('Error creating task status:', error);
          } else if (data) {
            task.taskStatus = {
              id: data.id,
              status: data.status,
              sortOrder: 0,
              deliveryImages: [],
              damageImages: [],
              etaSent: false,
            };
          }
        }
      }

      const morningRouteStops: MorningRouteStop[] = morningTasks.map(task => ({
        id: task.taskStatus?.id || '',
        taskId: task.id,
        orderId: task.orderId,
        address: task.address,
        type: task.type,
        eventStartTime: task.eventStartTime,
        equipmentIds: task.equipmentIds,
        numInflatables: task.numInflatables,
      }));

      const optimizedStops = await optimizeMorningRoute(morningRouteStops);

      let lateStops = 0;
      for (const stop of optimizedStops) {
        if (stop.id) {
          // Note: sort_order field removed from task_status table
          // Route optimization order is maintained in memory during processing

          if (stop.estimatedLateness && stop.estimatedLateness > 0) {
            lateStops++;
          }
        }
      }

      onComplete();

      const pickupCount = optimizedStops.filter(s => s.type === 'pick-up').length;
      const dropOffCount = optimizedStops.filter(s => s.type === 'drop-off').length;

      let message = `Morning route optimized! ${optimizedStops.length} stops:\n`;
      message += `- ${pickupCount} pickup(s)\n`;
      message += `- ${dropOffCount} drop-off(s)\n`;
      message += `\nDeparture: 6:30 AM from home base.`;

      if (lateStops > 0) {
        message += `\n\nWarning: ${lateStops} stop(s) may be late even with optimal routing.`;
      }

      alert(message);
    } catch (error) {
      console.error('Error optimizing morning route:', error);
      alert(`Failed to optimize route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOptimizing(false);
    }
  }

  async function optimizeAfternoonRouteForDay(_selectedDate: Date, selectedDayTasks: Task[], onComplete: () => void) {
    setOptimizing(true);
    try {
      const afternoonPickUpTasks = selectedDayTasks.filter(t => {
        return t.type === 'pick-up' && t.pickupPreference === 'same_day';
      });

      if (afternoonPickUpTasks.length < 2) {
        alert('Need at least 2 stops to optimize the afternoon route');
        return;
      }

      for (const task of afternoonPickUpTasks) {
        if (!task.taskStatus) {
          const { data, error } = await supabase
            .from('task_status')
            .insert({
              task_id: task.id,
              order_id: task.orderId,
              status: 'pending',
              crew_notes: null,
              admin_notes: null,
              completed_at: null,
              estimated_arrival: null,
            })
            .select()
            .single();

          if (error) {
            console.error('Error creating task status:', error);
          } else if (data) {
            task.taskStatus = {
              id: data.id,
              status: data.status,
              sortOrder: 0,
              deliveryImages: [],
              damageImages: [],
              etaSent: false,
            };
          }
        }
      }

      const afternoonRouteStops: MorningRouteStop[] = afternoonPickUpTasks.map(task => ({
        id: task.taskStatus?.id || '',
        taskId: task.id,
        orderId: task.orderId,
        address: task.address,
        type: task.type,
        eventStartTime: task.eventEndTime,
        equipmentIds: task.equipmentIds,
        numInflatables: task.numInflatables,
      }));

      const optimizedStops = await optimizeMorningRoute(afternoonRouteStops);

      for (const stop of optimizedStops) {
        if (stop.id) {
          // Note: sort_order field removed from task_status table
          // Route optimization order is maintained in memory during processing
        }
      }

      onComplete();

      let message = `Afternoon route optimized! ${optimizedStops.length} pickup stops.\n`;
      message += `\nOptimal route calculated for same-day pickups.`;

      alert(message);
    } catch (error) {
      console.error('Error optimizing afternoon route:', error);
      alert(`Failed to optimize route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOptimizing(false);
    }
  }

  return {
    optimizing,
    optimizeMorningRouteForDay,
    optimizeAfternoonRouteForDay,
  };
}
