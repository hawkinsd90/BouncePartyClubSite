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

// Max elements per DistanceMatrix request (origins × destinations ≤ MAX_MATRIX_ELEMENTS)
const MAX_MATRIX_ELEMENTS = 100;

async function getSingleDistanceMatrixChunk(
  origins: string[],
  destinations: string[],
  departureTime?: Date
): Promise<DistanceMatrixResult[][]> {
  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    const request: google.maps.DistanceMatrixRequest = {
      origins,
      destinations,
      travelMode: google.maps.TravelMode.DRIVING,
      unitSystem: google.maps.UnitSystem.IMPERIAL,
    };

    if (departureTime) {
      request.drivingOptions = {
        departureTime,
        trafficModel: google.maps.TrafficModel.BEST_GUESS,
      };
    }

    service.getDistanceMatrix(request, (response, status) => {
      const statusStr = status as unknown as string;
      if (statusStr !== 'OK') {
        console.error('[Route Optimization] Distance Matrix API error:', statusStr);
        const readable =
          statusStr === 'INVALID_REQUEST'
            ? 'One or more addresses could not be understood by Google Maps. Please verify all addresses are complete and valid.'
            : statusStr === 'MAX_ELEMENTS_EXCEEDED'
            ? 'Too many stops for a single Distance Matrix request. This is a bug — please report it.'
            : statusStr === 'OVER_DAILY_LIMIT' || statusStr === 'OVER_QUERY_LIMIT'
            ? 'Google Maps API quota exceeded. Please try again later or contact support.'
            : statusStr === 'REQUEST_DENIED'
            ? 'Google Maps API access denied. Please check the API key configuration.'
            : `Google Maps Distance Matrix error: ${statusStr}. Please check addresses and try again.`;
        reject(new Error(readable));
        return;
      }

      if (!response) {
        reject(new Error('No response from Distance Matrix API'));
        return;
      }

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
            rowResults.push({ distance: Infinity, duration: Infinity });
          }
        }
        results.push(rowResults);
      }

      resolve(results);
    });
  });
}

async function getDistanceMatrix(
  origins: string[],
  destinations: string[],
  departureTime?: Date
): Promise<DistanceMatrixResult[][]> {
  // console.log('[Route Optimization] Loading Google Maps API...');
  await loadGoogleMapsAPI();

  if (!window.google?.maps) {
    throw new Error('Google Maps API not loaded. Please check your API key configuration.');
  }

  const n = origins.length;
  const m = destinations.length;
  // console.log(`[Route Optimization] Calculating distance matrix (distances and durations) for ${n} origins × ${m} destinations...`);

  if (departureTime) {
    // console.log(`[Route Optimization] Using traffic-aware routing for ${departureTime.toLocaleString()}`);
  }

  // Determine max batch size per dimension so that batchO × batchD ≤ MAX_MATRIX_ELEMENTS
  // Use square batches: batchSize = floor(sqrt(MAX_MATRIX_ELEMENTS))
  const batchSize = Math.floor(Math.sqrt(MAX_MATRIX_ELEMENTS));

  // If the whole matrix fits in one request, do it directly
  if (n * m <= MAX_MATRIX_ELEMENTS) {
    // console.log('[Route Optimization] Matrix fits in single request');
    return getSingleDistanceMatrixChunk(origins, destinations, departureTime);
  }

  // console.log(`[Route Optimization] Matrix too large (${n * m} elements), splitting into ${batchSize}×${batchSize} chunks`);

  // Build full results matrix pre-filled with Infinity
  const results: DistanceMatrixResult[][] = Array.from({ length: n }, () =>
    Array.from({ length: m }, () => ({ distance: Infinity, duration: Infinity }))
  );

  // Process in chunks
  for (let oStart = 0; oStart < n; oStart += batchSize) {
    const oEnd = Math.min(oStart + batchSize, n);
    const originChunk = origins.slice(oStart, oEnd);

    for (let dStart = 0; dStart < m; dStart += batchSize) {
      const dEnd = Math.min(dStart + batchSize, m);
      const destChunk = destinations.slice(dStart, dEnd);

      // console.log(`[Route Optimization] Chunk origins[${oStart}-${oEnd - 1}] × destinations[${dStart}-${dEnd - 1}]`);

      const chunkResults = await getSingleDistanceMatrixChunk(originChunk, destChunk, departureTime);

      // Merge chunk into full matrix
      for (let i = 0; i < chunkResults.length; i++) {
        for (let j = 0; j < chunkResults[i].length; j++) {
          results[oStart + i][dStart + j] = chunkResults[i][j];
        }
      }
    }
  }

  // console.log('[Route Optimization] Distance matrix calculated successfully (batched)');
  return results;
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

/**
 * Debug helper: Logs a summary of all stops with equipment details
 */
function debugStopSummary(stops: MorningRouteStop[]): void {
  // console.log('[DEBUG] ========== STOP SUMMARY ==========');
  for (const stop of stops) {
    void stop.taskId;
    // console.log(`[DEBUG] Stop: ${stop.taskId}`);
    // console.log(`  - Type: ${stop.type}`);
    // console.log(`  - Address: ${stop.address}`);
    // console.log(`  - EquipmentIds: [${[...stop.equipmentIds].sort().join(', ')}]`);
    // console.log(`  - NumInflatables: ${stop.numInflatables ?? 0}`);
    // console.log(`  - EventStartTime: ${stop.eventStartTime ?? 'N/A'}`);
  }
  // console.log('[DEBUG] ====================================');
}

/**
 * Debug helper: Logs the dependency graph with reverse mappings
 */
function debugDependencyGraph(_deps: Map<string, string[]>, stops: MorningRouteStop[]): void {
  // console.log('[DEBUG] ========== DEPENDENCY GRAPH ==========');

  // Show drop-offs and their dependencies
  // console.log('[DEBUG] Drop-off dependencies:');
  for (const stop of stops) {
    if (stop.type === 'drop-off') {
      // console.log(`[DEBUG] DROP ${stop.taskId} depends on: [${(deps.get(stop.taskId) || []).join(', ')}]`);
    }
  }

  // Show reverse mapping per equipmentId
  // console.log('[DEBUG] Equipment ID mappings:');
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
    // console.log(`[DEBUG] EquipmentId "${equipId}":`);
    // console.log(`  - Pickup: ${equipmentToPickup.get(equipId) || 'NONE'}`);
    // console.log(`  - Drop-offs: [${(equipmentToDropoffs.get(equipId) || []).join(', ') || 'NONE'}]`);
  }

  // console.log('[DEBUG] =========================================');
}

/**
 * Validates equipment data integrity before route optimization
 */
function validateEquipmentData(stops: MorningRouteStop[]): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Build pickup equipment mapping
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

  // Check for duplicate pickups for same equipment
  for (const [equipId, pickupTaskIds] of pickupsByEquipment.entries()) {
    if (pickupTaskIds.length > 1) {
      errors.push(
        `equipmentId "${equipId}" appears in multiple pickups: ${pickupTaskIds.join(', ')} (ambiguous dependency)`
      );
    }
  }

  // Build map of equipmentId -> list of "taskId@address" strings for drop-offs that use it
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

  // Validate each stop
  for (const stop of stops) {
    // Check for missing equipment IDs
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

  // Check for equipmentId shared by multiple drop-offs with no pickup providing it
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

/**
 * Validates that the route respects all dependencies
 */
function validateRouteRespectsDependencies(route: OptimizedMorningStop[], dependencies: Map<string, string[]>): void {
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

  // console.log('[Route Validation] ✓ All dependencies satisfied in route order');
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

// Large but finite sentinel value used in scoring to deprioritize unreachable segments
// without causing NaN / ±Infinity in the comparisons.
const UNREACHABLE_SCORE_SENTINEL = 1e9;

function calculateScore(
  candidate: Candidate,
  baseDriveDurationSeconds: number,
  isHighPriority: boolean
): number {
  // Treat Infinity (unreachable segment) as a very high drive time so it's always
  // placed last in the greedy selection — but we don't break scoring arithmetic.
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
      // console.log('[Greedy Standard] First-leg candidate comparison (origin = matrix row 0):');
      sorted.forEach((_c, _i) => {
        // console.log(
        //   `  ${i + 1}. "${c.address}"${eligStr}${marker}\n` +
        //   `     drive: ${isFinite(c.driveMins) ? c.driveMins.toFixed(1) : 'Inf'} min, ` +
        //   `lateness: ${c.lateness.toFixed(0)} min, score: ${c.score.toFixed(2)}`
        // );
      });
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

function sortStopsByAngle(
  stops: MorningRouteStop[],
  homeBaseLat?: number,
  homeBaseLng?: number
): MorningRouteStop[] {
  if (homeBaseLat === undefined || homeBaseLng === undefined) {
    // console.log('[Geographic Sweep] Sweep ordering skipped (missing home base coords)');
    return stops;
  }

  const stopsWithCoords = stops.filter(stop =>
    stop.lat !== undefined && stop.lng !== undefined
  );

  if (stopsWithCoords.length < 3) {
    // console.log(`[Geographic Sweep] Sweep ordering skipped (only ${stopsWithCoords.length} stops have coords, need at least 3)`);
    return stops;
  }

  if (stopsWithCoords.length !== stops.length) {
    // console.log(`[Geographic Sweep] Sweep ordering skipped (${stops.length - stopsWithCoords.length} stops missing coords)`);
    return stops;
  }

  // console.log('[Geographic Sweep] Sweep ordering applied (coords present)');
  // console.log('[Geographic Sweep] Home base:', { lat: homeBaseLat, lng: homeBaseLng });

  const stopsWithAngles = stops.map((stop) => {
    const deltaLat = stop.lat! - homeBaseLat;
    const deltaLng = stop.lng! - homeBaseLng;
    const angle = Math.atan2(deltaLat, deltaLng);
    return { stop, angle };
  });

  stopsWithAngles.sort((a, b) => a.angle - b.angle);

  // console.log('[Geographic Sweep] Stops sorted by angle:',
  //   stopsWithAngles.map(s => `${s.stop.address} (${(s.angle * 180 / Math.PI).toFixed(1)}°)`).join(', ')
  // );

  return stopsWithAngles.map(s => s.stop);
}

async function generateMultipleGreedyRoutes(
  stops: MorningRouteStop[],
  distanceMatrix: DistanceMatrixResult[][],
  dependencies: Map<string, string[]>,
  departureTime: Date,
  matrixIndexByTaskId: Map<string, number>
): Promise<OptimizedMorningStop[]> {
  // console.log('[Multi-Start Greedy] Generating multiple route candidates...');

  const maxStarts = Math.min(stops.length, 8);
  const routes: OptimizedMorningStop[][] = [];

  for (let startIdx = 0; startIdx < maxStarts; startIdx++) {
    const startStop = stops[startIdx];

    const scheduled = new Set<string>();
    if (canSchedule(startStop, scheduled, dependencies)) {
      // console.log(`[Multi-Start Greedy] Attempt ${startIdx + 1}/${maxStarts}: Starting with ${startStop.address}`);

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
      // console.log(`[Multi-Start Greedy] Skipping start ${startIdx + 1}: dependencies not satisfied`);
    }
  }

  const standardRoute = await greedyRouteConstruction(stops, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  routes.push(standardRoute);

  let bestRoute = routes[0];
  let bestScore = evaluateRoute(bestRoute, distanceMatrix, departureTime, matrixIndexByTaskId);

  for (let i = 1; i < routes.length; i++) {
    const score = evaluateRoute(routes[i], distanceMatrix, departureTime, matrixIndexByTaskId);
    // console.log(`[Multi-Start Greedy] Route ${i + 1} score: ${score.toFixed(2)}`);

    if (score < bestScore) {
      bestScore = score;
      bestRoute = routes[i];
    }
  }

  // console.log(`[Multi-Start Greedy] Best route found with score: ${bestScore.toFixed(2)}`);
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

  // console.log(
  //   `[Greedy With Start] First leg from origin (matrix row 0) to "${firstStop.address}": ` +
  //   `${(driveDurationSeconds / 60).toFixed(1)} min drive`
  // );

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
  // console.log('[2-Opt] Starting 2-opt optimization...');

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
          // console.log(`[2-Opt] Improvement found: ${currentScore.toFixed(2)} → ${testScore.toFixed(2)}`);
          currentRoute = testRoute;
          improved = true;
          break;
        }
      }

      if (improved) break;
    }
  }

  // console.log(`[2-Opt] Completed after ${iterations} iterations`);

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

/**
 * Pre-validates stops before hitting the Distance Matrix API.
 * Catches blank/placeholder addresses and duplicates early.
 */
function preValidateStops(stops: MorningRouteStop[]): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const PLACEHOLDER_PATTERNS = /^(tbd|unknown|n\/a|na|address|none|test|placeholder|\s*)$/i;

  // Track normalized addresses for duplicate detection
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

    // Normalize for duplicate detection (lowercase, collapse spaces)
    const normalized = addr.toLowerCase().replace(/\s+/g, ' ');
    if (!seenAddresses.has(normalized)) {
      seenAddresses.set(normalized, []);
    }
    seenAddresses.get(normalized)!.push(stop.taskId);
  }

  // Report duplicates as warnings (they may be intentional — e.g., same venue, different tasks)
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

/**
 * After the distance matrix is built, scan for Infinity cells and warn about
 * unreachable segments. If every cell in a row is Infinity the stop is
 * completely unreachable and we throw so the caller can surface a clear error.
 */
function auditDistanceMatrix(
  matrix: DistanceMatrixResult[][],
  labels: string[]
): void {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const unreachable = row.filter(cell => cell.duration === Infinity);

    if (unreachable.length === row.length && row.length > 0) {
      // Every destination is unreachable from this origin
      const origin = labels[i] || `index ${i}`;
      throw new Error(
        `Could not calculate driving distances from "${origin}". ` +
        'This usually means the address is invalid, in an area with no road access, or the Google Maps API could not geocode it. ' +
        'Please verify the address and try again.'
      );
    }

    if (unreachable.length > 0) {
      const origin = labels[i] || `index ${i}`;
      console.warn(
        `[Route Optimization] ${unreachable.length} unreachable destination(s) from "${origin}". ` +
        'These segments will be treated as very long drives and may skew the route.'
      );
    }
  }
}

export interface RouteOriginOptions {
  address: string;
  label: string;
}

export async function optimizeMorningRoute(
  stops: MorningRouteStop[],
  originOverride?: RouteOriginOptions
): Promise<OptimizedMorningStop[]> {
  // console.log(`[Route Optimization] Starting optimization for ${stops.length} stops`);

  if (stops.length === 0) {
    // console.log('[Route Optimization] No stops to optimize');
    return [];
  }

  if (stops.length === 1) {
    // console.log('[Route Optimization] Only 1 stop, no optimization needed');
    return [{
      ...stops[0],
      sortOrder: 1,
      setupMinutes: stops[0].type === 'pick-up'
        ? PICKUP_MINUTES
        : (stops[0].numInflatables || 1) * SETUP_MINUTES_PER_UNIT,
      estimatedLateness: 0
    }];
  }

  // Pre-validate addresses before calling any API
  // console.log('[Route Optimization] Pre-validating stop addresses...');
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

  // console.log('[Route Optimization] Getting home base address...');
  const { getHomeBaseAddress } = await import('./adminSettingsCache');
  const homeBase = await getHomeBaseAddress();
  const homeBaseAddress = homeBase.address;
  // console.log('[Route Optimization] Home base:', homeBaseAddress);

  const originAddress = originOverride?.address ?? homeBaseAddress;
  const originLabel = originOverride?.label ?? 'Home Base';
  if (originOverride) {
    // console.log(`[Route Optimization] Origin override provided: "${originLabel}" → ${originAddress}`);
  } else {
    // console.log(`[Route Optimization] Using default origin: Home Base → ${originAddress}`);
  }

  const routeDateISO = stops[0]?.routeDateISO;
  let baseDate: Date;
  if (routeDateISO) {
    baseDate = new Date(routeDateISO + 'T00:00:00');
    // console.log('[Route Optimization] Route date from stops:', routeDateISO);
  } else {
    baseDate = new Date();
    // console.log('[Route Optimization] No route date specified, using today');
  }

  const [hours, minutes] = DEFAULT_DEPARTURE_TIME.split(':').map(Number);
  const departureTime = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes
  );
  // console.log('[Route Optimization] Departure time:', departureTime.toLocaleString());

  // Check if departure time is in the past
  const now = new Date();
  const trafficDepartureTime = departureTime > now ? departureTime : undefined;

  if (!trafficDepartureTime) {
    // console.log('[Route Optimization] Departure time is in the past. Traffic information is only available for future and current times.');
  }

  const addresses = [originAddress, ...stops.map(s => s.address)];
  // console.log(`[Route Optimization] Origin (matrix row 0): "${originLabel}" → ${originAddress}`);
  // console.log('[Route Optimization] Stop addresses:', stops.map((s, i) => `${i + 1}. ${s.address}`).join('\n'));

  const distanceMatrix = await getDistanceMatrix(addresses, addresses, trafficDepartureTime);

  // Audit matrix for unreachable segments before proceeding
  const matrixLabels = [originLabel, ...stops.map(s => s.address)];
  auditDistanceMatrix(distanceMatrix, matrixLabels);

  // console.log('[Route Optimization] Building matrix index map...');
  const matrixIndexByTaskId = new Map<string, number>();
  for (let i = 0; i < stops.length; i++) {
    matrixIndexByTaskId.set(stops[i].taskId, i + 1);
  }
  // console.log('[Route Optimization] Matrix index map created with', matrixIndexByTaskId.size, 'entries');

  // Debug: Show all stops with equipment details
  debugStopSummary(stops);

  // Build dependency graph
  const dependencies = buildDependencyGraph(stops);
  // console.log('[Route Optimization] Dependency graph built, dependencies:', dependencies.size);

  // Debug: Show dependency graph details
  debugDependencyGraph(dependencies, stops);

  // Count and log drop-offs with no dependencies
  void stops
    .filter(s => s.type === 'drop-off' && !dependencies.has(s.taskId))
    .map(s => s.taskId);
  // console.log(`[Route Optimization] Drop-offs with NO dependencies: ...`);

  // Preflight validation: Check equipment data integrity
  // console.log('[Route Optimization] Running preflight equipment validation...');
  const validation = validateEquipmentData(stops);

  // Log all warnings
  if (validation.warnings.length > 0) {
    console.warn('[Route Optimization] Equipment validation WARNINGS:');
    validation.warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  // Throw if there are errors
  if (validation.errors.length > 0) {
    console.error('[Route Optimization] Equipment validation ERRORS:');
    validation.errors.forEach(e => console.error(`  ✖ ${e}`));
    throw new Error(
      'Equipment validation failed:\n' + validation.errors.join('\n')
    );
  }

  // console.log('[Route Optimization] ✓ Preflight validation passed');

  // console.log('[Route Optimization] ========================================');
  // console.log('[Route Optimization] Starting Enhanced Optimization Pipeline');
  // console.log('[Route Optimization] ========================================');

  // console.log('[Route Optimization] Step 1/3: Geographic sweep ordering (always relative to home base)...');
  const sweepOrderedStops = sortStopsByAngle(stops, homeBase.lat, homeBase.lng);

  // console.log('[Route Optimization] Step 2/3: Multi-start greedy construction...');
  const greedyRoute = await generateMultipleGreedyRoutes(
    sweepOrderedStops,
    distanceMatrix,
    dependencies,
    departureTime,
    matrixIndexByTaskId
  );
  void evaluateRoute(greedyRoute, distanceMatrix, departureTime, matrixIndexByTaskId);
  // console.log('[Route Optimization] Best greedy route score:');
  // console.log('[Route Optimization] Greedy route order:', greedyRoute.map(r => r.address).join(' → '));

  // Post-route validation: Ensure greedy route respects dependencies
  // console.log('[Route Optimization] Validating greedy route dependencies...');
  validateRouteRespectsDependencies(greedyRoute, dependencies);

  // console.log('[Route Optimization] Step 3/3: 2-opt route optimization...');
  const optimizedRoute = twoOptOptimizeRoute(greedyRoute, distanceMatrix, dependencies, departureTime, matrixIndexByTaskId);
  void evaluateRoute(optimizedRoute, distanceMatrix, departureTime, matrixIndexByTaskId);
  // console.log('[Route Optimization] Final optimized score:');
  // console.log('[Route Optimization] Final route order:', optimizedRoute.map((r, i) => `${i + 1}. ${r.address}`).join(' → '));

  // Post-route validation: Ensure final route respects dependencies
  // console.log('[Route Optimization] Validating final route dependencies...');
  validateRouteRespectsDependencies(optimizedRoute, dependencies);

  // console.log('[Route Optimization] ========================================');
  // console.log('[Route Optimization] Optimization Complete');
  // console.log('[Route Optimization] ========================================');

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
