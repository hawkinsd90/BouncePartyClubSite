import type { MorningRouteStop } from './routeOptimizationTypes';

export function buildDependencyGraph(stops: MorningRouteStop[]): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();

  const pickupsByEquipment = new Map<string, MorningRouteStop>();
  for (const stop of stops) {
    if (stop.type === 'pick-up') {
      for (const equipId of stop.equipmentIds) {
        pickupsByEquipment.set(equipId, stop);
      }
    }
  }

  for (const stop of stops) {
    if (stop.type === 'drop-off') {
      const requiredPickups: string[] = [];
      for (const equipId of stop.equipmentIds) {
        const pickup = pickupsByEquipment.get(equipId);
        if (pickup && !requiredPickups.includes(pickup.taskId)) {
          requiredPickups.push(pickup.taskId);
        }
      }
      if (requiredPickups.length > 0) {
        dependencies.set(stop.taskId, requiredPickups);
      }
    }
  }

  return dependencies;
}

export function canSchedule(
  stop: MorningRouteStop,
  scheduled: Set<string>,
  dependencies: Map<string, string[]>
): boolean {
  const required = dependencies.get(stop.taskId) || [];
  return required.every(pickupId => scheduled.has(pickupId));
}

export function isRouteValid(
  route: { taskId: string }[],
  dependencies: Map<string, string[]>
): boolean {
  const completed = new Set<string>();

  for (const stop of route) {
    const required = dependencies.get(stop.taskId) || [];

    for (const requiredTaskId of required) {
      if (!completed.has(requiredTaskId)) {
        return false;
      }
    }

    completed.add(stop.taskId);
  }

  return true;
}
