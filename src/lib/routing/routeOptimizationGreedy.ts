import type { MorningRouteStop, OptimizedMorningStop, DistanceMatrixResult, Candidate } from './routeOptimizationTypes';
import { formatTime, isEarlyEvent, PICKUP_MINUTES, SETUP_MINUTES_PER_UNIT } from './routeOptimizationUtils';
import { canSchedule } from './routeOptimizationDependencies';
import { calculateLateness, calculateScore, evaluateRoute } from './routeOptimizationScoring';

export async function greedyRouteConstruction(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): Promise<OptimizedMorningStop[]> {
  const route: OptimizedMorningStop[] = [];
  const scheduled = new Set<string>();
  let currentTime = new Date(departureTime);
  let currentMatrixIndex = 0;
  let firstLegLogged = false;

  const firstLegCandidates: Array<{ address: string; driveMins: number; lateness: number; score: number; eligible: boolean }> = [];

  while (scheduled.size < stops.length) {
    let bestCandidate: Candidate | null = null;
    let bestStop: MorningRouteStop | null = null;

    for (const stop of stops) {
      if (scheduled.has(stop.taskId)) continue;

      const stopMatrixIndex = matrixIndexByTaskId.get(stop.taskId);
      if (stopMatrixIndex === undefined) {
        throw new Error(`[Route Optimization] Missing matrix index for ${stop.taskId} (${stop.address})`);
      }

      const isEligible = canSchedule(stop, scheduled, dependencies);
      const driveDurationSeconds = distanceMatrix[currentMatrixIndex][stopMatrixIndex].duration;
      const arrivalTime = new Date(currentTime.getTime() + driveDurationSeconds * 1000);
      const setupMinutes = stop.type === 'pick-up'
        ? PICKUP_MINUTES
        : (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
      const lateness = calculateLateness(arrivalTime, stop, setupMinutes);
      const baseDriveDurationSeconds = distanceMatrix[0][stopMatrixIndex].duration;
      const isHighPriority =
        isEarlyEvent(stop.eventStartTime) ||
        stop.type === 'pick-up' ||
        (stop.feedsOrderIds && stop.feedsOrderIds.length > 0);

      const candidate: Candidate = { stop, driveDurationSeconds, arrivalTime, lateness, score: 0 };
      candidate.score = calculateScore(candidate, baseDriveDurationSeconds, isHighPriority || false);

      if (!firstLegLogged) {
        firstLegCandidates.push({
          address: stop.address,
          driveMins: isFinite(driveDurationSeconds) ? driveDurationSeconds / 60 : Infinity,
          lateness,
          score: candidate.score,
          eligible: isEligible,
        });
      }

      if (!isEligible) continue;

      if (bestCandidate === null || candidate.score < bestCandidate.score) {
        bestCandidate = candidate;
        bestStop = stop;
      }
    }

    if (!bestCandidate || !bestStop) break;

    const setupMinutes = bestCandidate.stop.type === 'pick-up'
      ? PICKUP_MINUTES
      : (bestCandidate.stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

    const bestStopMatrixIndex = matrixIndexByTaskId.get(bestStop.taskId);
    if (bestStopMatrixIndex === undefined) {
      throw new Error(`[Route Optimization] Missing matrix index for ${bestStop.taskId} (${bestStop.address})`);
    }

    if (!firstLegLogged) {
      firstLegLogged = true;
      const sorted = [...firstLegCandidates].sort((a, b) => a.score - b.score);
      sorted.forEach((_c, _i) => { void _c; });
    }

    route.push({
      ...bestCandidate.stop,
      sortOrder: route.length + 1,
      distanceFromPreviousMeters: distanceMatrix[currentMatrixIndex][bestStopMatrixIndex].distance,
      durationFromPreviousSeconds: distanceMatrix[currentMatrixIndex][bestStopMatrixIndex].duration,
      arrivalTime: formatTime(bestCandidate.arrivalTime),
      setupMinutes,
      estimatedLateness: bestCandidate.lateness
    });

    scheduled.add(bestCandidate.stop.taskId);
    currentTime = new Date(bestCandidate.arrivalTime.getTime() + setupMinutes * 60 * 1000);
    currentMatrixIndex = bestStopMatrixIndex;
  }

  return route;
}

export async function greedyRouteConstructionWithStart(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  startStopIndex: number,
  matrixIndexByTaskId: Map<string, number>
): Promise<OptimizedMorningStop[]> {
  const route: OptimizedMorningStop[] = [];
  const scheduled = new Set<string>();
  let currentTime = new Date(departureTime);

  const firstStop = stops[startStopIndex];
  const firstStopMatrixIndex = matrixIndexByTaskId.get(firstStop.taskId);
  if (firstStopMatrixIndex === undefined) {
    throw new Error(`[Route Optimization] Missing matrix index for ${firstStop.taskId} (${firstStop.address})`);
  }

  const driveDurationSeconds = distanceMatrix[0][firstStopMatrixIndex].duration;
  const arrivalTime = new Date(currentTime.getTime() + driveDurationSeconds * 1000);
  const setupMinutes = firstStop.type === 'pick-up'
    ? PICKUP_MINUTES
    : (firstStop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

  route.push({
    ...firstStop,
    sortOrder: 1,
    distanceFromPreviousMeters: distanceMatrix[0][firstStopMatrixIndex].distance,
    durationFromPreviousSeconds: driveDurationSeconds,
    arrivalTime: formatTime(arrivalTime),
    setupMinutes,
    estimatedLateness: calculateLateness(arrivalTime, firstStop, setupMinutes)
  });

  scheduled.add(firstStop.taskId);
  currentTime = new Date(arrivalTime.getTime() + setupMinutes * 60 * 1000);
  let currentMatrixIndex = firstStopMatrixIndex;

  while (scheduled.size < stops.length) {
    let bestCandidate: Candidate | null = null;
    let bestStop: MorningRouteStop | null = null;

    for (const stop of stops) {
      if (scheduled.has(stop.taskId)) continue;
      if (!canSchedule(stop, scheduled, dependencies)) continue;

      const stopMatrixIndex = matrixIndexByTaskId.get(stop.taskId);
      if (stopMatrixIndex === undefined) {
        throw new Error(`[Route Optimization] Missing matrix index for ${stop.taskId} (${stop.address})`);
      }

      const driveDurationSeconds = distanceMatrix[currentMatrixIndex][stopMatrixIndex].duration;
      const arrivalTime = new Date(currentTime.getTime() + driveDurationSeconds * 1000);
      const setupMinutes = stop.type === 'pick-up'
        ? PICKUP_MINUTES
        : (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
      const lateness = calculateLateness(arrivalTime, stop, setupMinutes);

      const baseDriveDurationSeconds = distanceMatrix[0][stopMatrixIndex].duration;
      const isHighPriority =
        isEarlyEvent(stop.eventStartTime) ||
        stop.type === 'pick-up' ||
        (stop.feedsOrderIds && stop.feedsOrderIds.length > 0);

      const candidate: Candidate = {
        stop,
        driveDurationSeconds,
        arrivalTime,
        lateness,
        score: 0
      };
      candidate.score = calculateScore(candidate, baseDriveDurationSeconds, isHighPriority || false);

      if (bestCandidate === null || candidate.score < bestCandidate.score) {
        bestCandidate = candidate;
        bestStop = stop;
      }
    }

    if (!bestCandidate || !bestStop) break;

    const setupMinutes = bestCandidate.stop.type === 'pick-up'
      ? PICKUP_MINUTES
      : (bestCandidate.stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

    const bestStopMatrixIndex = matrixIndexByTaskId.get(bestStop.taskId);
    if (bestStopMatrixIndex === undefined) {
      throw new Error(`[Route Optimization] Missing matrix index for ${bestStop.taskId} (${bestStop.address})`);
    }

    route.push({
      ...bestCandidate.stop,
      sortOrder: route.length + 1,
      distanceFromPreviousMeters: distanceMatrix[currentMatrixIndex][bestStopMatrixIndex].distance,
      durationFromPreviousSeconds: distanceMatrix[currentMatrixIndex][bestStopMatrixIndex].duration,
      arrivalTime: formatTime(bestCandidate.arrivalTime),
      setupMinutes,
      estimatedLateness: bestCandidate.lateness
    });

    scheduled.add(bestCandidate.stop.taskId);
    currentTime = new Date(bestCandidate.arrivalTime.getTime() + setupMinutes * 60 * 1000);
    currentMatrixIndex = bestStopMatrixIndex;
  }

  return route;
}

export async function generateMultipleGreedyRoutes(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): Promise<OptimizedMorningStop[]> {
  const maxStarts = Math.min(stops.length, 8);
  const routes: OptimizedMorningStop[][] = [];

  for (let startIdx = 0; startIdx < maxStarts; startIdx++) {
    const startStop = stops[startIdx];
    const scheduled = new Set<string>();

    if (canSchedule(startStop, scheduled, dependencies)) {
      const route = await greedyRouteConstructionWithStart(
        stops,
        distanceMatrix,
        dependencies,
        departureTime,
        startIdx,
        matrixIndexByTaskId
      );
      routes.push(route);
    }
  }

  const standardRoute = await greedyRouteConstruction(stops, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  routes.push(standardRoute);

  let bestRoute = routes[0];
  let bestScore = evaluateRoute(bestRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

  for (let i = 1; i < routes.length; i++) {
    const score = evaluateRoute(routes[i], distanceMatrix, departureTime, matrixIndexByTaskId);
    if (score < bestScore) {
      bestScore = score;
      bestRoute = routes[i];
    }
  }

  return bestRoute;
}
