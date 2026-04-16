import { loadGoogleMapsAPI } from './googleMaps';
import type { DistanceMatrixResult } from './routeOptimizationTypes';

const MAX_MATRIX_ELEMENTS = 100;

export async function getSingleDistanceMatrixChunk(
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

export async function getDistanceMatrix(
  origins: string[],
  destinations: string[],
  departureTime?: Date
): Promise<DistanceMatrixResult[][]> {
  await loadGoogleMapsAPI();

  if (!window.google?.maps) {
    throw new Error('Google Maps API not loaded. Please check your API key configuration.');
  }

  const n = origins.length;
  const m = destinations.length;

  const batchSize = Math.floor(Math.sqrt(MAX_MATRIX_ELEMENTS));

  if (n * m <= MAX_MATRIX_ELEMENTS) {
    return getSingleDistanceMatrixChunk(origins, destinations, departureTime);
  }

  const results: DistanceMatrixResult[][] = Array.from({ length: n }, () =>
    Array.from({ length: m }, () => ({ distance: Infinity, duration: Infinity }))
  );

  for (let oStart = 0; oStart < n; oStart += batchSize) {
    const oEnd = Math.min(oStart + batchSize, n);
    const originChunk = origins.slice(oStart, oEnd);

    for (let dStart = 0; dStart < m; dStart += batchSize) {
      const dEnd = Math.min(dStart + batchSize, m);
      const destChunk = destinations.slice(dStart, dEnd);

      const chunkResults = await getSingleDistanceMatrixChunk(originChunk, destChunk, departureTime);

      for (let i = 0; i < chunkResults.length; i++) {
        for (let j = 0; j < chunkResults[i].length; j++) {
          results[oStart + i][dStart + j] = chunkResults[i][j];
        }
      }
    }
  }

  return results;
}

export function auditDistanceMatrix(
  matrix: DistanceMatrixResult[][],
  labels: string[]
): void {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const unreachable = row.filter(cell => cell.duration === Infinity);

    if (unreachable.length === row.length && row.length > 0) {
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
