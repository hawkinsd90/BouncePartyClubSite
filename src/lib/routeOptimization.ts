import type { MorningRouteStop, OptimizedMorningStop, RouteOriginOptions } from './routeOptimizationTypes';
import { getDistanceMatrix, auditDistanceMatrix } from './routeOptimizationDistanceMatrix';
import { preValidateStops, validateEquipmentData, validateRouteRespectsDependencies } from './routeOptimizationValidation';
import { buildDependencyGraph } from './routeOptimizationDependencies';
import { evaluateRoute } from './routeOptimizationScoring';
import { generateMultipleGreedyRoutes } from './routeOptimizationGreedy';
import { sortStopsByAngle, twoOptOptimizeRoute } from './routeOptimizationLocalSearch';
import { debugStopSummary, debugDependencyGraph, DEFAULT_DEPARTURE_TIME, PICKUP_MINUTES, SETUP_MINUTES_PER_UNIT } from './routeOptimizationUtils';

export type { MorningRouteStop, OptimizedMorningStop, RouteOriginOptions };

export async function optimizeMorningRoute(
  stops: MorningRouteStop[],
  originOverride?: RouteOriginOptions
): Promise<OptimizedMorningStop[]> {
  if (stops.length === 0) {
    return [];
  }

  if (stops.length === 1) {
    return [{
      ...stops[0],
      sortOrder: 1,
      setupMinutes: stops[0].type === 'pick-up'
        ? PICKUP_MINUTES
        : (stops[0].numInflatables || 1) * SETUP_MINUTES_PER_UNIT,
      estimatedLateness: 0
    }];
  }

  const addressValidation = preValidateStops(stops);
  if (addressValidation.warnings.length > 0) {
    addressValidation.warnings.forEach(w => console.warn(`[Route Optimization] Address warning: ${w}`));
  }
  if (addressValidation.errors.length > 0) {
    addressValidation.errors.forEach(e => console.error(`[Route Optimization] Address error: ${e}`));
    throw new Error(
      'Route optimization cannot proceed — address issues found:\n' +
      addressValidation.errors.join('\n')
    );
  }

  const { getHomeBaseAddress } = await import('./adminSettingsCache');
  const homeBase = await getHomeBaseAddress();
  const homeBaseAddress = homeBase.address;

  const originAddress = originOverride?.address ?? homeBaseAddress;
  const originLabel = originOverride?.label ?? 'Home Base';

  const routeDateISO = stops[0]?.routeDateISO;
  let baseDate: Date;
  if (routeDateISO) {
    baseDate = new Date(routeDateISO + 'T00:00:00');
  } else {
    baseDate = new Date();
  }

  const [hours, minutes] = DEFAULT_DEPARTURE_TIME.split(':').map(Number);
  const departureTime = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes
  );

  const now = new Date();
  const trafficDepartureTime = departureTime > now ? departureTime : undefined;

  const addresses = [originAddress, ...stops.map(s => s.address)];
  const distanceMatrix = await getDistanceMatrix(addresses, addresses, trafficDepartureTime);

  const matrixLabels = [originLabel, ...stops.map(s => s.address)];
  auditDistanceMatrix(distanceMatrix, matrixLabels);

  const matrixIndexByTaskId = new Map<string, number>();
  for (let i = 0; i < stops.length; i++) {
    matrixIndexByTaskId.set(stops[i].taskId, i + 1);
  }

  debugStopSummary(stops);

  const dependencies = buildDependencyGraph(stops);

  debugDependencyGraph(dependencies, stops);

  void stops
    .filter(s => s.type === 'drop-off' && !dependencies.has(s.taskId))
    .map(s => s.taskId);

  const validation = validateEquipmentData(stops);

  if (validation.warnings.length > 0) {
    console.warn('[Route Optimization] Equipment validation WARNINGS:');
    validation.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  if (validation.errors.length > 0) {
    console.error('[Route Optimization] Equipment validation ERRORS:');
    validation.errors.forEach(e => console.error(`  ✖ ${e}`));
    throw new Error(
      'Equipment validation failed:\n' + validation.errors.join('\n')
    );
  }

  const sweepOrderedStops = sortStopsByAngle(stops, homeBase.lat, homeBase.lng);

  const greedyRoute = await generateMultipleGreedyRoutes(
    sweepOrderedStops,
    distanceMatrix,
    dependencies,
    departureTime,
    matrixIndexByTaskId
  );
  void evaluateRoute(greedyRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

  validateRouteRespectsDependencies(greedyRoute, dependencies);

  const optimizedRoute = twoOptOptimizeRoute(greedyRoute, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  void evaluateRoute(optimizedRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

  validateRouteRespectsDependencies(optimizedRoute, dependencies);

  return optimizedRoute;
}

export function formatDistance(meters: number): string {
  const miles = meters * 0.000621371;
  return `${miles.toFixed(1)} mi`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
