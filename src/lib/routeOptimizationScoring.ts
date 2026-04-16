import type { Candidate, MorningRouteStop, OptimizedMorningStop, DistanceMatrixResult } from './routeOptimizationTypes';
import { parseTimeToMinutes, UNREACHABLE_SCORE_SENTINEL, PICKUP_MINUTES, SETUP_MINUTES_PER_UNIT } from './routeOptimizationUtils';

export function calculateLateness(
  arrivalTime: Date,
  stop: MorningRouteStop,
  setupMinutes: number
): number {
  if (!stop.eventStartTime || stop.type === 'pick-up') {
    return 0;
  }

  const eventMinutes = parseTimeToMinutes(stop.eventStartTime);
  const arrivalMinutes = arrivalTime.getHours() * 60 + arrivalTime.getMinutes();
  const finishSetupMinutes = arrivalMinutes + setupMinutes;

  return Math.max(0, finishSetupMinutes - eventMinutes);
}

export function calculateScore(
  candidate: Candidate,
  baseDriveDurationSeconds: number,
  isHighPriority: boolean
): number {
  const rawDrive = candidate.driveDurationSeconds;
  const driveDurationMinutes = isFinite(rawDrive) ? rawDrive / 60 : UNREACHABLE_SCORE_SENTINEL;
  const baseDriveDurationMinutes = isFinite(baseDriveDurationSeconds) ? baseDriveDurationSeconds / 60 : 0;

  const LATENESS_PENALTY = 100;
  const FAR_EARLY_BONUS = 0.1;
  const HIGH_PRIORITY_BONUS = 50;

  let score = driveDurationMinutes;
  score += candidate.lateness * LATENESS_PENALTY;
  score -= baseDriveDurationMinutes * FAR_EARLY_BONUS;

  if (isHighPriority) {
    score -= HIGH_PRIORITY_BONUS;
  }

  return score;
}

export function evaluateRoute(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): number {
  let totalDuration = 0;
  let totalLateness = 0;
  let currentTime = new Date(departureTime);
  let currentMatrixIndex = 0;

  for (const stop of route) {
    const stopMatrixIndex = matrixIndexByTaskId.get(stop.taskId);
    if (stopMatrixIndex === undefined) {
      throw new Error(`[Route Optimization] Missing matrix index for ${stop.taskId} (${stop.address})`);
    }

    const rawDriveSecs = distanceMatrix[currentMatrixIndex][stopMatrixIndex].duration;
    const driveDurationSeconds = isFinite(rawDriveSecs) ? rawDriveSecs : 0;
    totalDuration += driveDurationSeconds;

    currentTime = new Date(currentTime.getTime() + driveDurationSeconds * 1000);
    const setupMinutes = stop.type === 'pick-up'
      ? PICKUP_MINUTES
      : (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
    const lateness = calculateLateness(currentTime, stop, setupMinutes);
    totalLateness += lateness;

    currentTime = new Date(currentTime.getTime() + setupMinutes * 60 * 1000);
    currentMatrixIndex = stopMatrixIndex;
  }

  return totalDuration + totalLateness * 100;
}
