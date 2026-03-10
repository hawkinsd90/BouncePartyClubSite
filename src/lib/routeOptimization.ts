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
}

export interface OptimizedMorningStop extends MorningRouteStop {
  sortOrder: number;
  distanceFromPrevious?: number;
  durationFromPrevious?: number;
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
  driveDuration: number;
  arrivalTime: Date;
  lateness: number;
  score: number;
}

async function getDistanceMatrix(
  origins: string[],
  destinations: string[]
): Promise<DistanceMatrixResult[][]> {
  console.log('[Route Optimization] Loading Google Maps API...');
  await loadGoogleMapsAPI();

  // Ensure Google Maps is available
  if (!window.google?.maps) {
    throw new Error('Google Maps API not loaded. Please check your API key configuration.');
  }

  // Ensure importLibrary is available
  if (typeof google.maps.importLibrary !== 'function') {
    throw new Error('Google Maps importLibrary not available');
  }

  console.log('[Route Optimization] Loading Distance Matrix service...');
  // Load the routes library which includes DistanceMatrixService
  const routesLib = await google.maps.importLibrary("routes");
  const DistanceMatrixService = routesLib.DistanceMatrixService;

  console.log(`[Route Optimization] Calculating distances for ${origins.length} locations...`);
  return new Promise((resolve, reject) => {
    const service = new DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins,
        destinations,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      },
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
  distanceFromBase: number,
  isHighPriority: boolean
): number {
  const driveDurationMinutes = candidate.driveDuration / 60;
  const distanceFromBaseMinutes = distanceFromBase / 60;

  const LATENESS_PENALTY = 100;
  const FAR_EARLY_BONUS = 0.1;
  const HIGH_PRIORITY_BONUS = 50;

  let score = driveDurationMinutes;
  score += candidate.lateness * LATENESS_PENALTY;
  score -= distanceFromBaseMinutes * FAR_EARLY_BONUS;

  if (isHighPriority) {
    score -= HIGH_PRIORITY_BONUS;
  }

  return score;
}

async function greedyRouteConstruction(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date
): Promise<OptimizedMorningStop[]> {
  const route: OptimizedMorningStop[] = [];
  const scheduled = new Set<string>();
  let currentTime = new Date(departureTime);
  let currentLocationIndex = 0;

  while (scheduled.size < stops.length) {
    let bestCandidate: Candidate | null = null;
    let bestStopIndex = -1;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];

      if (scheduled.has(stop.taskId)) continue;
      if (!canSchedule(stop, scheduled, dependencies)) continue;

      const driveDuration = distanceMatrix[currentLocationIndex][i + 1].duration;
      const arrivalTime = new Date(currentTime.getTime() + driveDuration * 1000);
      const setupMinutes = stop.type === 'pick-up'
        ? PICKUP_MINUTES
        : (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
      const lateness = calculateLateness(arrivalTime, stop, setupMinutes);

      const distanceFromBase = distanceMatrix[0][i + 1].duration;
      const isHighPriority =
        isEarlyEvent(stop.eventStartTime) ||
        stop.type === 'pick-up' ||
        (stop.feedsOrderIds && stop.feedsOrderIds.length > 0);

      const candidate: Candidate = {
        stop,
        driveDuration,
        arrivalTime,
        lateness,
        score: 0
      };
      candidate.score = calculateScore(candidate, distanceFromBase, isHighPriority || false);

      if (bestCandidate === null || candidate.score < bestCandidate.score) {
        bestCandidate = candidate;
        bestStopIndex = i;
      }
    }

    if (!bestCandidate) break;

    const setupMinutes = bestCandidate.stop.type === 'pick-up'
      ? PICKUP_MINUTES
      : (bestCandidate.stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

    route.push({
      ...bestCandidate.stop,
      sortOrder: route.length + 1,
      distanceFromPrevious: distanceMatrix[currentLocationIndex][bestStopIndex + 1].distance,
      durationFromPrevious: distanceMatrix[currentLocationIndex][bestStopIndex + 1].duration,
      arrivalTime: formatTime(bestCandidate.arrivalTime),
      setupMinutes,
      estimatedLateness: bestCandidate.lateness
    });

    scheduled.add(bestCandidate.stop.taskId);
    currentTime = new Date(bestCandidate.arrivalTime.getTime() + setupMinutes * 60 * 1000);
    currentLocationIndex = bestStopIndex + 1;
  }

  return route;
}

function trySwapImprovement(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date
): OptimizedMorningStop[] {
  let improved = true;
  let currentRoute = [...route];

  while (improved) {
    improved = false;

    for (let i = 0; i < currentRoute.length - 1; i++) {
      const stopA = currentRoute[i];
      const stopB = currentRoute[i + 1];

      const depsB = dependencies.get(stopB.taskId) || [];
      if (depsB.includes(stopA.taskId)) {
        continue;
      }

      const testRoute = [...currentRoute];
      [testRoute[i], testRoute[i + 1]] = [testRoute[i + 1], testRoute[i]];

      const currentScore = evaluateRoute(currentRoute, distanceMatrix, departureTime);
      const testScore = evaluateRoute(testRoute, distanceMatrix, departureTime);

      if (testScore < currentScore) {
        currentRoute = testRoute;
        improved = true;
        break;
      }
    }
  }

  for (let i = 0; i < currentRoute.length; i++) {
    currentRoute[i].sortOrder = i + 1;
  }

  return currentRoute;
}

function evaluateRoute(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  departureTime: Date
): number {
  let totalDuration = 0;
  let totalLateness = 0;
  let currentTime = new Date(departureTime);

  for (let i = 0; i < route.length; i++) {
    const prevIndex = i;
    const currentIndex = i + 1;

    const driveDuration = distanceMatrix[prevIndex][currentIndex].duration;
    totalDuration += driveDuration;

    currentTime = new Date(currentTime.getTime() + driveDuration * 1000);
    const setupMinutes = route[i].type === 'pick-up'
      ? PICKUP_MINUTES
      : (route[i].numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
    const lateness = calculateLateness(currentTime, route[i], setupMinutes);
    totalLateness += lateness;

    currentTime = new Date(currentTime.getTime() + setupMinutes * 60 * 1000);
  }

  return totalDuration + totalLateness * 100;
}

/**
 * IMPROVEMENT 1: Geographic Sweep Ordering
 *
 * Sorts stops by their geographic angle relative to the home base.
 * This groups nearby stops together and prevents zig-zag routes.
 */
async function sortStopsByAngle(
  stops: MorningRouteStop[],
  homeBaseAddress: string
): Promise<MorningRouteStop[]> {
  console.log('[Geographic Sweep] Getting coordinates for all locations...');

  // Load Google Maps API
  await loadGoogleMapsAPI();
  if (!window.google?.maps) {
    console.warn('[Geographic Sweep] Google Maps not available, skipping geographic sort');
    return stops;
  }

  const geocoder = new google.maps.Geocoder();

  // Geocode all addresses
  const geocodeAddress = (address: string): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
          const location = results[0].geometry.location;
          resolve({ lat: location.lat(), lng: location.lng() });
        } else {
          console.warn(`[Geographic Sweep] Failed to geocode: ${address}`);
          resolve(null);
        }
      });
    });
  };

  // Get home base coordinates
  const homeCoords = await geocodeAddress(homeBaseAddress);
  if (!homeCoords) {
    console.warn('[Geographic Sweep] Could not geocode home base, skipping geographic sort');
    return stops;
  }

  console.log('[Geographic Sweep] Home base coordinates:', homeCoords);

  // Get coordinates for all stops
  const stopsWithCoords = await Promise.all(
    stops.map(async (stop) => {
      const coords = await geocodeAddress(stop.address);
      return { stop, coords };
    })
  );

  // Calculate angles and sort
  const stopsWithAngles = stopsWithCoords.map(({ stop, coords }) => {
    let angle = 0;
    if (coords) {
      // Calculate angle from home base using atan2
      const deltaLat = coords.lat - homeCoords.lat;
      const deltaLng = coords.lng - homeCoords.lng;
      angle = Math.atan2(deltaLat, deltaLng);
    }
    return { stop, angle };
  });

  // Sort by angle
  stopsWithAngles.sort((a, b) => a.angle - b.angle);

  console.log('[Geographic Sweep] Stops sorted by angle:',
    stopsWithAngles.map(s => `${s.stop.address} (${(s.angle * 180 / Math.PI).toFixed(1)}°)`).join(', ')
  );

  return stopsWithAngles.map(s => s.stop);
}

/**
 * IMPROVEMENT 2: Multi-Start Greedy Construction
 *
 * Runs greedy route construction multiple times with different starting stops
 * to find a better initial solution.
 */
async function generateMultipleGreedyRoutes(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date
): Promise<OptimizedMorningStop[]> {
  console.log('[Multi-Start Greedy] Generating multiple route candidates...');

  const maxStarts = Math.min(stops.length, 8);
  const routes: OptimizedMorningStop[][] = [];

  // Generate routes with different starting points
  for (let startIdx = 0; startIdx < maxStarts; startIdx++) {
    const startStop = stops[startIdx];

    // Check if this stop can be scheduled first (dependencies satisfied)
    const scheduled = new Set<string>();
    if (canSchedule(startStop, scheduled, dependencies)) {
      console.log(`[Multi-Start Greedy] Attempt ${startIdx + 1}/${maxStarts}: Starting with ${startStop.address}`);

      // Create a modified greedy construction that starts with this specific stop
      const route = await greedyRouteConstructionWithStart(
        stops,
        distanceMatrix,
        dependencies,
        departureTime,
        startIdx
      );

      routes.push(route);
    } else {
      console.log(`[Multi-Start Greedy] Skipping start ${startIdx + 1}: dependencies not satisfied`);
    }
  }

  // Also include the standard greedy route
  const standardRoute = await greedyRouteConstruction(stops, distanceMatrix, dependencies, departureTime);
  routes.push(standardRoute);

  // Evaluate all routes and pick the best one
  let bestRoute = routes[0];
  let bestScore = evaluateRoute(bestRoute, distanceMatrix, departureTime);

  for (let i = 1; i < routes.length; i++) {
    const score = evaluateRoute(routes[i], distanceMatrix, departureTime);
    console.log(`[Multi-Start Greedy] Route ${i + 1} score: ${score.toFixed(2)}`);

    if (score < bestScore) {
      bestScore = score;
      bestRoute = routes[i];
    }
  }

  console.log(`[Multi-Start Greedy] Best route found with score: ${bestScore.toFixed(2)}`);
  return bestRoute;
}

/**
 * Helper for multi-start greedy: runs greedy construction starting with a specific stop
 */
async function greedyRouteConstructionWithStart(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  startStopIndex: number
): Promise<OptimizedMorningStop[]> {
  const route: OptimizedMorningStop[] = [];
  const scheduled = new Set<string>();
  let currentTime = new Date(departureTime);

  // Start with the specified stop
  const firstStop = stops[startStopIndex];
  const driveDuration = distanceMatrix[0][startStopIndex + 1].duration;
  const arrivalTime = new Date(currentTime.getTime() + driveDuration * 1000);
  const setupMinutes = firstStop.type === 'pick-up'
    ? PICKUP_MINUTES
    : (firstStop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

  route.push({
    ...firstStop,
    sortOrder: 1,
    distanceFromPrevious: distanceMatrix[0][startStopIndex + 1].distance,
    durationFromPrevious: driveDuration,
    arrivalTime: formatTime(arrivalTime),
    setupMinutes,
    estimatedLateness: calculateLateness(arrivalTime, firstStop, setupMinutes)
  });

  scheduled.add(firstStop.taskId);
  currentTime = new Date(arrivalTime.getTime() + setupMinutes * 60 * 1000);
  let currentLocationIndex = startStopIndex + 1;

  // Continue with standard greedy for remaining stops
  while (scheduled.size < stops.length) {
    let bestCandidate: Candidate | null = null;
    let bestStopIndex = -1;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];

      if (scheduled.has(stop.taskId)) continue;
      if (!canSchedule(stop, scheduled, dependencies)) continue;

      const driveDuration = distanceMatrix[currentLocationIndex][i + 1].duration;
      const arrivalTime = new Date(currentTime.getTime() + driveDuration * 1000);
      const setupMinutes = stop.type === 'pick-up'
        ? PICKUP_MINUTES
        : (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
      const lateness = calculateLateness(arrivalTime, stop, setupMinutes);

      const distanceFromBase = distanceMatrix[0][i + 1].duration;
      const isHighPriority =
        isEarlyEvent(stop.eventStartTime) ||
        stop.type === 'pick-up' ||
        (stop.feedsOrderIds && stop.feedsOrderIds.length > 0);

      const candidate: Candidate = {
        stop,
        driveDuration,
        arrivalTime,
        lateness,
        score: 0
      };
      candidate.score = calculateScore(candidate, distanceFromBase, isHighPriority || false);

      if (bestCandidate === null || candidate.score < bestCandidate.score) {
        bestCandidate = candidate;
        bestStopIndex = i;
      }
    }

    if (!bestCandidate) break;

    const setupMinutes = bestCandidate.stop.type === 'pick-up'
      ? PICKUP_MINUTES
      : (bestCandidate.stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

    route.push({
      ...bestCandidate.stop,
      sortOrder: route.length + 1,
      distanceFromPrevious: distanceMatrix[currentLocationIndex][bestStopIndex + 1].distance,
      durationFromPrevious: distanceMatrix[currentLocationIndex][bestStopIndex + 1].duration,
      arrivalTime: formatTime(bestCandidate.arrivalTime),
      setupMinutes,
      estimatedLateness: bestCandidate.lateness
    });

    scheduled.add(bestCandidate.stop.taskId);
    currentTime = new Date(bestCandidate.arrivalTime.getTime() + setupMinutes * 60 * 1000);
    currentLocationIndex = bestStopIndex + 1;
  }

  return route;
}

/**
 * IMPROVEMENT 3: True 2-Opt Route Optimization
 *
 * Replaces adjacent-swap with full 2-opt optimization.
 * This reverses route segments to find improvements.
 */
function twoOptOptimizeRoute(
  route: OptimizedMorningStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date
): OptimizedMorningStop[] {
  console.log('[2-Opt] Starting 2-opt optimization...');

  let improved = true;
  let currentRoute = [...route];
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Prevent infinite loops

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;

    // Try all possible segment reversals
    for (let i = 0; i < currentRoute.length - 1; i++) {
      for (let j = i + 1; j < currentRoute.length; j++) {
        // Create test route by reversing segment [i...j]
        const testRoute = [
          ...currentRoute.slice(0, i),
          ...currentRoute.slice(i, j + 1).reverse(),
          ...currentRoute.slice(j + 1)
        ];

        // Check if this reversal violates any dependencies
        if (!isRouteValid(testRoute, dependencies)) {
          continue;
        }

        // Evaluate the new route
        const currentScore = evaluateRoute(currentRoute, distanceMatrix, departureTime);
        const testScore = evaluateRoute(testRoute, distanceMatrix, departureTime);

        if (testScore < currentScore) {
          console.log(`[2-Opt] Improvement found: ${currentScore.toFixed(2)} → ${testScore.toFixed(2)}`);
          currentRoute = testRoute;
          improved = true;
          break; // Restart from beginning with new route
        }
      }

      if (improved) break; // Restart outer loop
    }
  }

  console.log(`[2-Opt] Completed after ${iterations} iterations`);

  // Update sort orders
  for (let i = 0; i < currentRoute.length; i++) {
    currentRoute[i].sortOrder = i + 1;
  }

  return currentRoute;
}

/**
 * Helper: Check if a route violates any dependencies
 */
function isRouteValid(
  route: OptimizedMorningStop[],
  dependencies: Map<string, string[]>
): boolean {
  const completed = new Set<string>();

  for (const stop of route) {
    const required = dependencies.get(stop.taskId) || [];

    // Check if all required stops are already completed
    for (const requiredTaskId of required) {
      if (!completed.has(requiredTaskId)) {
        return false; // Dependency not satisfied
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

  // Get home base address for routing
  console.log('[Route Optimization] Getting home base address...');
  const { getHomeBaseAddress } = await import('./adminSettingsCache');
  const homeBase = await getHomeBaseAddress();
  const homeBaseAddress = homeBase.address;
  console.log('[Route Optimization] Home base:', homeBaseAddress);

  const addresses = [homeBaseAddress, ...stops.map(s => s.address)];
  console.log('[Route Optimization] Stop addresses:', stops.map((s, i) => `${i + 1}. ${s.address}`).join('\n'));

  const distanceMatrix = await getDistanceMatrix(addresses, addresses);

  const dependencies = buildDependencyGraph(stops);
  console.log('[Route Optimization] Dependency graph built, dependencies:', dependencies.size);

  const today = new Date();
  const [hours, minutes] = DEFAULT_DEPARTURE_TIME.split(':').map(Number);
  const departureTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
  console.log('[Route Optimization] Departure time:', departureTime.toLocaleTimeString());

  // IMPROVED OPTIMIZATION PIPELINE
  console.log('[Route Optimization] ========================================');
  console.log('[Route Optimization] Starting Enhanced Optimization Pipeline');
  console.log('[Route Optimization] ========================================');

  // Step 1: Geographic Sweep Ordering
  console.log('[Route Optimization] Step 1/3: Geographic sweep ordering...');
  const sweepOrderedStops = await sortStopsByAngle(stops, homeBaseAddress);

  // Step 2: Multi-Start Greedy Construction
  console.log('[Route Optimization] Step 2/3: Multi-start greedy construction...');
  const greedyRoute = await generateMultipleGreedyRoutes(
    sweepOrderedStops,
    distanceMatrix,
    dependencies,
    departureTime
  );
  const greedyScore = evaluateRoute(greedyRoute, distanceMatrix, departureTime);
  console.log('[Route Optimization] Best greedy route score:', greedyScore.toFixed(2));
  console.log('[Route Optimization] Greedy route order:', greedyRoute.map(r => r.address).join(' → '));

  // Step 3: 2-Opt Optimization
  console.log('[Route Optimization] Step 3/3: 2-opt route optimization...');
  const optimizedRoute = twoOptOptimizeRoute(greedyRoute, distanceMatrix, dependencies, departureTime);
  const finalScore = evaluateRoute(optimizedRoute, distanceMatrix, departureTime);
  console.log('[Route Optimization] Final optimized score:', finalScore.toFixed(2));
  console.log('[Route Optimization] Improvement:', ((greedyScore - finalScore) / greedyScore * 100).toFixed(1) + '%');
  console.log('[Route Optimization] Final route:', optimizedRoute.map((r, i) => `${i + 1}. ${r.address} (taskId: ${r.taskId})`).join('\n'));

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
