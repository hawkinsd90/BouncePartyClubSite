import type { MorningRouteStop, OptimizedMorningStop } from './routeOptimizationTypes';

export function validateEquipmentData(stops: MorningRouteStop[]): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const pickupEquipmentIds = new Set<string>();
  const pickupsByEquipment = new Map<string, string[]>();

  for (const stop of stops) {
    if (stop.type === 'pick-up') {
      for (const equipId of stop.equipmentIds) {
        pickupEquipmentIds.add(equipId);
        if (!pickupsByEquipment.has(equipId)) {
          pickupsByEquipment.set(equipId, []);
        }
        pickupsByEquipment.get(equipId)!.push(stop.taskId);
      }
    }
  }

  for (const [equipId, pickupTaskIds] of pickupsByEquipment.entries()) {
    if (pickupTaskIds.length > 1) {
      errors.push(
        `equipmentId "${equipId}" appears in multiple pickups: ${pickupTaskIds.join(', ')} (ambiguous dependency)`
      );
    }
  }

  const dropoffsByEquipment = new Map<string, string[]>();
  for (const stop of stops) {
    if (stop.type === 'drop-off' && stop.equipmentIds && stop.equipmentIds.length > 0) {
      for (const equipId of stop.equipmentIds) {
        if (!dropoffsByEquipment.has(equipId)) {
          dropoffsByEquipment.set(equipId, []);
        }
        dropoffsByEquipment.get(equipId)!.push(`${stop.taskId}@${stop.address}`);
      }
    }
  }

  for (const stop of stops) {
    if (!stop.equipmentIds || stop.equipmentIds.length === 0) {
      if (stop.type === 'drop-off' && (stop.numInflatables ?? 0) > 0) {
        errors.push(
          `Drop-off ${stop.taskId} has ${stop.numInflatables} inflatables but NO equipmentIds (cannot create dependencies)`
        );
      } else {
        warnings.push(
          `Stop ${stop.taskId} (${stop.type}) has empty/missing equipmentIds`
        );
      }
    }
  }

  for (const [equipId, dropoffEntries] of dropoffsByEquipment.entries()) {
    if (dropoffEntries.length > 1) {
      if (!pickupEquipmentIds.has(equipId)) {
        warnings.push(
          `equipmentId "${equipId}" is used by multiple drop-offs in this route but no pickup provides it. Verify inventory / double-booking. Drop-offs: ${dropoffEntries.join(', ')}`
        );
      } else {
        warnings.push(
          `equipmentId "${equipId}" is used by multiple drop-offs in this route. A pickup provides it, but only one drop-off can receive it via same-day handoff. Verify intended use. Drop-offs: ${dropoffEntries.join(', ')}`
        );
      }
    }
  }

  return { warnings, errors };
}

export function validateRouteRespectsDependencies(route: OptimizedMorningStop[], dependencies: Map<string, string[]>): void {
  const completed = new Set<string>();

  for (let i = 0; i < route.length; i++) {
    const stop = route[i];
    const required = dependencies.get(stop.taskId) || [];

    for (const requiredTaskId of required) {
      if (!completed.has(requiredTaskId)) {
        const requiredStop = route.find(s => s.taskId === requiredTaskId);
        throw new Error(
          `[Route Validation ERROR] Stop #${i + 1} (${stop.type} ${stop.taskId} at ${stop.address}) ` +
          `requires dependency ${requiredTaskId} which has not been completed yet. ` +
          `Required stop: ${requiredStop ? `${requiredStop.type} at ${requiredStop.address}` : 'NOT FOUND IN ROUTE'}. ` +
          `This violates equipment pickup/drop-off constraints.`
        );
      }
    }

    completed.add(stop.taskId);
  }
}

export function preValidateStops(stops: MorningRouteStop[]): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const PLACEHOLDER_PATTERNS = /^(tbd|unknown|n\/a|na|address|none|test|placeholder|\s*)$/i;
  const seenAddresses = new Map<string, string[]>();

  for (const stop of stops) {
    const addr = (stop.address || '').trim();

    if (!addr) {
      errors.push(`Stop ${stop.taskId} (${stop.type}) has no address. Please add a valid address before optimizing.`);
      continue;
    }

    if (PLACEHOLDER_PATTERNS.test(addr)) {
      errors.push(`Stop ${stop.taskId} (${stop.type}) has an invalid placeholder address: "${addr}". Please fix before optimizing.`);
      continue;
    }

    const normalized = addr.toLowerCase().replace(/\s+/g, ' ');
    if (!seenAddresses.has(normalized)) {
      seenAddresses.set(normalized, []);
    }
    seenAddresses.get(normalized)!.push(stop.taskId);
  }

  for (const [addr, taskIds] of seenAddresses.entries()) {
    if (taskIds.length > 1) {
      warnings.push(
        `Duplicate address detected (${addr}): stops ${taskIds.join(', ')}. ` +
        'Route distances between these stops may be zero — verify this is intentional.'
      );
    }
  }

  return { warnings, errors };
}
