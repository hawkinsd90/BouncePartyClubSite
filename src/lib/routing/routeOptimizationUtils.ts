import type { MorningRouteStop } from './routeOptimizationTypes';

export const DEFAULT_DEPARTURE_TIME = '06:20';
export const SETUP_MINUTES_PER_UNIT = 20;
export const PICKUP_MINUTES = 15;
export const UNREACHABLE_SCORE_SENTINEL = 1e9;

export function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function isEarlyEvent(eventStartTime?: string): boolean {
  if (!eventStartTime) return false;
  const minutes = parseTimeToMinutes(eventStartTime);
  return minutes < 9 * 60;
}

export function debugStopSummary(stops: MorningRouteStop[]): void {
  for (const stop of stops) {
    void stop.taskId;
  }
}

export function debugDependencyGraph(_deps: Map<string, string[]>, stops: MorningRouteStop[]): void {
  for (const stop of stops) {
    if (stop.type === 'drop-off') {
      void stop.taskId;
    }
  }

  const equipmentToPickup = new Map<string, string>();
  const equipmentToDropoffs = new Map<string, string[]>();

  for (const stop of stops) {
    if (stop.type === 'pick-up') {
      for (const equipId of stop.equipmentIds) {
        equipmentToPickup.set(equipId, stop.taskId);
      }
    }
  }

  for (const stop of stops) {
    if (stop.type === 'drop-off') {
      for (const equipId of stop.equipmentIds) {
        if (!equipmentToDropoffs.has(equipId)) {
          equipmentToDropoffs.set(equipId, []);
        }
        equipmentToDropoffs.get(equipId)!.push(stop.taskId);
      }
    }
  }

  const allEquipIds = new Set([...equipmentToPickup.keys(), ...equipmentToDropoffs.keys()]);
  for (const _equipId of allEquipIds) {
    void _equipId;
  }
}
