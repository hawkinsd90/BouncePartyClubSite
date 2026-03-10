import { loadGoogleMapsAPI } from './googleMaps';

const DEFAULT_DEPARTURE_TIME = '06:20';
const SETUP_MINUTES_PER_UNIT = 20;
const PICKUP_MINUTES = 15;

export interface MorningRouteStop {
  id: string;
  taskId: string;
  orderId: string;
  address: string;
  type: 'drop-off' | 'pick-up';
  eventStartTime?: string;
  equipmentIds: string[];
  feedsOrderIds?: string[];
  numInflatables?: number;
  lat?: number;
  lng?: number;
  routeDateISO?: string; // YYYY-MM-DD format for the route date
}

export interface OptimizedMorningStop extends MorningRouteStop {
  sortOrder: number;
  distanceFromPreviousMeters?: number;
  durationFromPreviousSeconds?: number;
  arrivalTime?: string;
  setupMinutes?: number;
  estimatedLateness?: number;
}

interface DistanceMatrixResult {
  distance: number;
  duration: number;
}

interface Candidate {
  stop: MorningRouteStop;
  driveDurationSeconds: number;
  arrivalTime: Date;
  lateness: number;
  score: number;
}

async function getDistanceMatrix(
  origins: string[],
  destinations: string[],
  departureTime?: Date
): Promise<DistanceMatrixResult[][]> {
  console.log('[Route Optimization] Loading Google Maps API...');
  await loadGoogleMapsAPI();

  if (!window.google?.maps) {
    throw new Error('Google Maps API not loaded. Please check your API key configuration.');
  }

  if (typeof google.maps.importLibrary !== 'function') {
    throw new Error('Google Maps importLibrary not available');
  }

  console.log('[Route Optimization] Loading Distance Matrix service...');
  const routesLib = await google.maps.importLibrary("routes");
  const DistanceMatrixService = routesLib.DistanceMatrixService;

  console.log(`[Route Optimization] Calculating distance matrix (distances and durations) for ${origins.length} locations...`);
  if (departureTime) {
    console.log(`[Route Optimization] Using traffic-aware routing for ${departureTime.toLocaleString()}`);
  }

  return new Promise((resolve, reject) => {
    const service = new DistanceMatrixService();

    const request: google.maps.DistanceMatrixRequest = {
      origins,
      destinations,
      travelMode: google.maps.TravelMode.DRIVING,
      unitSystem: google.maps.UnitSystem.IMPERIAL,
    };

    // Add traffic-aware options if departure time provided
    if (departureTime) {
      request.drivingOptions = {
        departureTime: departureTime,
        trafficModel: google.maps.TrafficModel.BEST_GUESS,
      };
    }

    service.getDistanceMatrix(
      request,
      (response, status) => {
        if (status !== 'OK') {
          console.error('[Route Optimization] Distance Matrix API error:', status);
          reject(new Error(`Distance Matrix API error: ${status}. This may be due to invalid addresses or API quota limits.`));
          return;
        }

        if (!response) {
          reject(new Error('No response from Distance Matrix API'));
          return;
        }

        console.log('[Route Optimization] Distance matrix calculated successfully');
        const results: DistanceMatrixResult[][] = [];

        for (const row of response.rows) {
          const rowResults: DistanceMatrixResult[] = [];
          for (const element of row.elements) {
            if (element.status === 'OK') {
              rowResults.push({
                distance: element.distance.value,
                duration: element.duration.value,
              });
            } else {
              console.warn('[Route Optimization] Failed to get distance for route segment:', element.status);
              rowResults.push({
                distance: Infinity,
                duration: Infinity,
              });
            }
          }
          results.push(rowResults);
        }

        resolve(results);
      }
    );
  });
}

function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function isEarlyEvent(eventStartTime?: string): boolean {
  if (!eventStartTime) return false;
  const minutes = parseTimeToMinutes(eventStartTime);
  return minutes < 9 * 60;
}

function buildDependencyGraph(stops: MorningRouteStop[]): Map<string, string[]> {
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

function canSchedule(
  stop: MorningRouteStop,
  scheduled: Set<string>,
  dependencies: Map<string, string[]>
): boolean {
  const required = dependencies.get(stop.taskId) || [];
  return required.every(pickupId => scheduled.has(pickupId));
}

function calculateLateness(
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

function calculateScore(
  candidate: Candidate,
  baseDriveDurationSeconds: number,
  isHighPriority: boolean
): number {
  const driveDurationMinutes = candidate.driveDurationSeconds / 60;
  const baseDriveDurationMinutes = baseDriveDurationSeconds / 60;

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

async function greedyRouteConstruction(
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

function evaluateRoute(
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

    const driveDurationSeconds = distanceMatrix[currentMatrixIndex][stopMatrixIndex].duration;
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

function sortStopsByAngle(
  stops: MorningRouteStop[],
  homeBaseLat?: number,
  homeBaseLng?: number
): MorningRouteStop[] {
  if (homeBaseLat === undefined || homeBaseLng === undefined) {
    console.log('[Geographic Sweep] Sweep ordering skipped (missing home base coords)');
    return stops;
  }

  const stopsWithCoords = stops.filter(stop =>
    stop.lat !== undefined && stop.lng !== undefined
  );

  if (stopsWithCoords.length < 3) {
    console.log(`[Geographic Sweep] Sweep ordering skipped (only ${stopsWithCoords.length} stops have coords, need at least 3)`);
    return stops;
  }

  if (stopsWithCoords.length !== stops.length) {
    console.log(`[Geographic Sweep] Sweep ordering skipped (${stops.length - stopsWithCoords.length} stops missing coords)`);
    return stops;
  }

  console.log('[Geographic Sweep] Sweep ordering applied (coords present)');
  console.log('[Geographic Sweep] Home base:', { lat: homeBaseLat, lng: homeBaseLng });

  const stopsWithAngles = stops.map((stop) => {
    const deltaLat = stop.lat! - homeBaseLat;
    const deltaLng = stop.lng! - homeBaseLng;
    const angle = Math.atan2(deltaLat, deltaLng);
    return { stop, angle };
  });

  stopsWithAngles.sort((a, b) => a.angle - b.angle);

  console.log('[Geographic Sweep] Stops sorted by angle:',
    stopsWithAngles.map(s => `${s.stop.address} (${(s.angle * 180 / Math.PI).toFixed(1)}°)`).join(', ')
  );

  return stopsWithAngles.map(s => s.stop);
}

async function generateMultipleGreedyRoutes(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): Promise<OptimizedMorningStop[]> {
  console.log('[Multi-Start Greedy] Generating multiple route candidates...');

  const maxStarts = Math.min(stops.length, 8);
  const routes: OptimizedMorningStop[][] = [];

  for (let startIdx = 0; startIdx < maxStarts; startIdx++) {
    const startStop = stops[startIdx];

    const scheduled = new Set<string>();
    if (canSchedule(startStop, scheduled, dependencies)) {
      console.log(`[Multi-Start Greedy] Attempt ${startIdx + 1}/${maxStarts}: Starting with ${startStop.address}`);

      const route = await greedyRouteConstructionWithStart(
        stops,
        distanceMatrix,
        dependencies,
        departureTime,
        startIdx,
        matrixIndexByTaskId
      );

      routes.push(route);
    } else {
      console.log(`[Multi-Start Greedy] Skipping start ${startIdx + 1}: dependencies not satisfied`);
    }
  }

  const standardRoute = await greedyRouteConstruction(stops, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  routes.push(standardRoute);

  let bestRoute = routes[0];
  let bestScore = evaluateRoute(bestRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

  for (let i = 1; i < routes.length; i++) {
    const score = evaluateRoute(routes[i], distanceMatrix, departureTime, matrixIndexByTaskId);
    console.log(`[Multi-Start Greedy] Route ${i + 1} score: ${score.toFixed(2)}`);

    if (score < bestScore) {
      bestScore = score;
      bestRoute = routes[i];
    }
  }

  console.log(`[Multi-Start Greedy] Best route found with score: ${bestScore.toFixed(2)}`);
  return bestRoute;
}

async function greedyRouteConstructionWithStart(
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

function twoOptOptimizeRoute(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): OptimizedMorningStop[] {
  console.log('[2-Opt] Starting 2-opt optimization...');

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
          console.log(`[2-Opt] Improvement found: ${currentScore.toFixed(2)} → ${testScore.toFixed(2)}`);
          currentRoute = testRoute;
          improved = true;
          break;
        }
      }

      if (improved) break;
    }
  }

  console.log(`[2-Opt] Completed after ${iterations} iterations`);

  for (let i = 0; i < currentRoute.length; i++) {
    currentRoute[i].sortOrder = i + 1;
  }

  return currentRoute;
}

function isRouteValid(
  route: OptimizedMorningStop[],
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

export async function optimizeMorningRoute(stops: MorningRouteStop[]): Promise<OptimizedMorningStop[]> {
  console.log(`[Route Optimization] Starting optimization for ${stops.length} stops`);

  if (stops.length === 0) {
    console.log('[Route Optimization] No stops to optimize');
    return [];
  }

  if (stops.length === 1) {
    console.log('[Route Optimization] Only 1 stop, no optimization needed');
    return [{
      ...stops[0],
      sortOrder: 1,
      setupMinutes: stops[0].type === 'pick-up'
        ? PICKUP_MINUTES
        : (stops[0].numInflatables || 1) * SETUP_MINUTES_PER_UNIT,
      estimatedLateness: 0
    }];
  }

  console.log('[Route Optimization] Getting home base address...');
  const { getHomeBaseAddress } = await import('./adminSettingsCache');
  const homeBase = await getHomeBaseAddress();
  const homeBaseAddress = homeBase.address;
  console.log('[Route Optimization] Home base:', homeBaseAddress);

  const routeDateISO = stops[0]?.routeDateISO;
  let baseDate: Date;
  if (routeDateISO) {
    baseDate = new Date(routeDateISO + 'T00:00:00');
    console.log('[Route Optimization] Route date from stops:', routeDateISO);
  } else {
    baseDate = new Date();
    console.log('[Route Optimization] No route date specified, using today');
  }

  const [hours, minutes] = DEFAULT_DEPARTURE_TIME.split(':').map(Number);
  const departureTime = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes
  );
  console.log('[Route Optimization] Departure time:', departureTime.toLocaleString());

  const addresses = [homeBaseAddress, ...stops.map(s => s.address)];
  console.log('[Route Optimization] Stop addresses:', stops.map((s, i) => `${i + 1}. ${s.address}`).join('\n'));

  const distanceMatrix = await getDistanceMatrix(addresses, addresses, departureTime);

  console.log('[Route Optimization] Building matrix index map...');
  const matrixIndexByTaskId = new Map<string, number>();
  for (let i = 0; i < stops.length; i++) {
    matrixIndexByTaskId.set(stops[i].taskId, i + 1);
  }
  console.log('[Route Optimization] Matrix index map created with', matrixIndexByTaskId.size, 'entries');

  const dependencies = buildDependencyGraph(stops);
  console.log('[Route Optimization] Dependency graph built, dependencies:', dependencies.size);

  console.log('[Route Optimization] ========================================');
  console.log('[Route Optimization] Starting Enhanced Optimization Pipeline');
  console.log('[Route Optimization] ========================================');

  console.log('[Route Optimization] Step 1/3: Geographic sweep ordering...');
  const sweepOrderedStops = sortStopsByAngle(stops, homeBase.lat, homeBase.lng);

  console.log('[Route Optimization] Step 2/3: Multi-start greedy construction...');
  const greedyRoute = await generateMultipleGreedyRoutes(
    sweepOrderedStops,
    distanceMatrix,
    dependencies,
    departureTime,
    matrixIndexByTaskId
  );
  const greedyScore = evaluateRoute(greedyRoute, distanceMatrix, departureTime, matrixIndexByTaskId);
  console.log('[Route Optimization] Best greedy route score:', greedyScore.toFixed(2));
  console.log('[Route Optimization] Greedy route order:', greedyRoute.map(r => r.address).join(' → '));

  console.log('[Route Optimization] Step 3/3: 2-opt route optimization...');
  const optimizedRoute = twoOptOptimizeRoute(greedyRoute, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  const finalScore = evaluateRoute(optimizedRoute, distanceMatrix, departureTime, matrixIndexByTaskId);
  console.log('[Route Optimization] Final optimized score:', finalScore.toFixed(2));
  console.log('[Route Optimization] Improvement from greedy:', ((greedyScore - finalScore) / greedyScore * 100).toFixed(1) + '%');
  console.log('[Route Optimization] Final route order:', optimizedRoute.map((r, i) => `${i + 1}. ${r.address}`).join(' → '));

  console.log('[Route Optimization] ========================================');
  console.log('[Route Optimization] Optimization Complete');
  console.log('[Route Optimization] ========================================');

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
