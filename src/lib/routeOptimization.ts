import { loadGoogleMapsAPI } from './googleMaps';

const HOME_BASE_ADDRESS = '4426 Woodward St, Wayne, MI 48184';

export interface RouteStop {
  id: string;
  address: string;
  taskType: 'drop-off' | 'pick-up';
}

export interface OptimizedStop extends RouteStop {
  sortOrder: number;
  distanceFromPrevious?: number;
  durationFromPrevious?: number;
}

interface DistanceMatrixResult {
  distance: number;
  duration: number;
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

export async function optimizeRoute(stops: RouteStop[]): Promise<OptimizedStop[]> {
  if (stops.length === 0) {
    return [];
  }

  if (stops.length === 1) {
    return [{
      ...stops[0],
      sortOrder: 1,
    }];
  }

  const addresses = [HOME_BASE_ADDRESS, ...stops.map(s => s.address)];

  const distanceMatrix = await getDistanceMatrix(addresses, addresses);

  const optimizedStops: OptimizedStop[] = [];
  const visited = new Set<number>();
  let currentIndex = 0;
  let sortOrder = 1;

  while (visited.size < stops.length) {
    let nearestIndex = -1;
    let shortestDistance = Infinity;

    for (let i = 1; i < addresses.length; i++) {
      if (!visited.has(i - 1)) {
        const distance = distanceMatrix[currentIndex][i].distance;
        if (distance < shortestDistance) {
          shortestDistance = distance;
          nearestIndex = i;
        }
      }
    }

    if (nearestIndex === -1) break;

    const stopIndex = nearestIndex - 1;
    visited.add(stopIndex);

    optimizedStops.push({
      ...stops[stopIndex],
      sortOrder,
      distanceFromPrevious: distanceMatrix[currentIndex][nearestIndex].distance,
      durationFromPrevious: distanceMatrix[currentIndex][nearestIndex].duration,
    });

    currentIndex = nearestIndex;
    sortOrder++;
  }

  return optimizedStops;
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
