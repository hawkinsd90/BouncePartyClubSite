import { loadGoogleMapsAPI } from './googleMaps';

const HOME_BASE_ADDRESS = '4426 Woodward St, Wayne, MI 48184';
const DEFAULT_DEPARTURE_TIME = '06:30';
const SETUP_MINUTES_PER_UNIT = 20;

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
  await loadGoogleMapsAPI();

  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins,
        destinations,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      },
      (response, status) => {
        if (status !== 'OK') {
          reject(new Error(`Distance Matrix API error: ${status}`));
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
      const setupMinutes = (stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
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

    const setupMinutes = (bestCandidate.stop.numInflatables || 1) * SETUP_MINUTES_PER_UNIT;

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
    const setupMinutes = (route[i].numInflatables || 1) * SETUP_MINUTES_PER_UNIT;
    const lateness = calculateLateness(currentTime, route[i], setupMinutes);
    totalLateness += lateness;

    currentTime = new Date(currentTime.getTime() + setupMinutes * 60 * 1000);
  }

  return totalDuration + totalLateness * 100;
}

export async function optimizeMorningRoute(stops: MorningRouteStop[]): Promise<OptimizedMorningStop[]> {
  if (stops.length === 0) {
    return [];
  }

  if (stops.length === 1) {
    return [{
      ...stops[0],
      sortOrder: 1,
      setupMinutes: (stops[0].numInflatables || 1) * SETUP_MINUTES_PER_UNIT,
      estimatedLateness: 0
    }];
  }

  const addresses = [HOME_BASE_ADDRESS, ...stops.map(s => s.address)];
  const distanceMatrix = await getDistanceMatrix(addresses, addresses);

  const dependencies = buildDependencyGraph(stops);

  const today = new Date();
  const [hours, minutes] = DEFAULT_DEPARTURE_TIME.split(':').map(Number);
  const departureTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);

  let route = await greedyRouteConstruction(stops, distanceMatrix, dependencies, departureTime);

  route = trySwapImprovement(route, distanceMatrix, dependencies, departureTime);

  return route;
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
