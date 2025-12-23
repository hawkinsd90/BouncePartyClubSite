export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function calculateDrivingDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<number> {
  console.log('[calculateDrivingDistance] Called with:', { originLat, originLng, destLat, destLng });

  // Use straight-line distance × 1.4 as fallback (approximates driving distance)
  const straightLine = calculateDistance(originLat, originLng, destLat, destLng);
  const fallbackDistance = straightLine * 1.4;
  console.log('[calculateDrivingDistance] Calculated fallback distance:', {
    straightLine: straightLine.toFixed(2),
    fallback: fallbackDistance.toFixed(2),
  });

  // Wait for Google Maps to load (with 5 second timeout)
  try {
    console.log('[calculateDrivingDistance] Waiting for Google Maps to load...');
    await Promise.race([
      (async () => {
        const { loadGoogleMapsAPI } = await import('./googleMaps');
        await loadGoogleMapsAPI();
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Google Maps load timeout')), 5000))
    ]);
  } catch (error) {
    console.warn('[calculateDrivingDistance] Failed to load Google Maps, using fallback:', error);
    return fallbackDistance;
  }

  // Check if Google Maps is available
  if (!window.google?.maps?.DistanceMatrixService) {
    console.log('[calculateDrivingDistance] Google Maps not available after loading, using fallback');
    return fallbackDistance;
  }

  console.log('[calculateDrivingDistance] Google Maps is available, attempting Distance Matrix API call');

  try {
    const service = new google.maps.DistanceMatrixService();
    const origin = new google.maps.LatLng(originLat, originLng);
    const destination = new google.maps.LatLng(destLat, destLng);

    return new Promise((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (response, status) => {
          console.log('[calculateDrivingDistance] Distance Matrix API response:', { status, response });

          if (status === 'OK' && response?.rows?.[0]?.elements?.[0]?.status === 'OK') {
            const distanceMeters = response.rows[0].elements[0].distance?.value;
            if (distanceMeters) {
              // Convert meters to miles
              const distanceMiles = distanceMeters / 1609.34;
              console.log(`[calculateDrivingDistance] Success! Driving distance: ${distanceMiles.toFixed(2)} miles`);
              resolve(distanceMiles);
              return;
            }
          }

          console.warn('[calculateDrivingDistance] Distance Matrix API failed, using straight-line approximation:', status);
          console.warn('[calculateDrivingDistance] Returning fallback:', fallbackDistance.toFixed(2), 'miles');
          resolve(fallbackDistance);
        }
      );
    });
  } catch (error) {
    console.error('[calculateDrivingDistance] Error calculating driving distance:', error);
    console.log('[calculateDrivingDistance] Returning fallback due to error:', fallbackDistance.toFixed(2), 'miles');
    return fallbackDistance;
  }
}
