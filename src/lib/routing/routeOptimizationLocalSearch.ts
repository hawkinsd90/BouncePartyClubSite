import type { OptimizedMorningStop, MorningRouteStop, DistanceMatrixResult } from './routeOptimizationTypes';
import { isRouteValid } from './routeOptimizationDependencies';
import { evaluateRoute } from './routeOptimizationScoring';

export function sortStopsByAngle(
  stops: MorningRouteStop[],
  homeBaseLat?: number,
  homeBaseLng?: number
): MorningRouteStop[] {
  if (homeBaseLat === undefined || homeBaseLng === undefined) {
    return stops;
  }

  const stopsWithCoords = stops.filter(stop =>
    stop.lat !== undefined && stop.lng !== undefined
  );

  if (stopsWithCoords.length < 3) {
    return stops;
  }

  if (stopsWithCoords.length !== stops.length) {
    return stops;
  }

  const stopsWithAngles = stops.map((stop) => {
    const deltaLat = stop.lat! - homeBaseLat;
    const deltaLng = stop.lng! - homeBaseLng;
    const angle = Math.atan2(deltaLat, deltaLng);
    return { stop, angle };
  });

  stopsWithAngles.sort((a, b) => a.angle - b.angle);

  return stopsWithAngles.map(s => s.stop);
}

export function twoOptOptimizeRoute(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): OptimizedMorningStop[] {
  let improved = true;
  let currentRoute = [...route];
  let iterations = 0;
  const MAX_ITERATIONS = 100;

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;

    for (let i = 0; i < currentRoute.length - 1; i++) {
      for (let j = i + 1; j < currentRoute.length; j++) {
        const testRoute = [
          ...currentRoute.slice(0, i),
          ...currentRoute.slice(i, j + 1).reverse(),
          ...currentRoute.slice(j + 1)
        ];

        if (!isRouteValid(testRoute, dependencies)) {
          continue;
        }

        const currentScore = evaluateRoute(currentRoute, distanceMatrix, departureTime, matrixIndexByTaskId);
        const testScore = evaluateRoute(testRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

        if (testScore < currentScore) {
          currentRoute = testRoute;
          improved = true;
          break;
        }
      }

      if (improved) break;
    }
  }

  for (let i = 0; i < currentRoute.length; i++) {
    currentRoute[i].sortOrder = i + 1;
  }

  return currentRoute;
}
