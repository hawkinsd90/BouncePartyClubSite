import { loadGoogleMapsAPI } from './googleMapsLoader';

export interface CrewLocation {
  lat: number;
  lng: number;
}

export interface ETAResult {
  durationMinutes: number;
  durationText: string;
  distanceText: string;
  location: CrewLocation;
}

export async function getCurrentLocation(): Promise<CrewLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        let errorMessage = 'Unable to get your location';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            break;
        }
        reject(new Error(errorMessage));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

export async function calculateETA(
  origin: CrewLocation,
  destinationAddress: string
): Promise<ETAResult> {
  await loadGoogleMapsAPI();

  if (!window.google?.maps?.DistanceMatrixService) {
    throw new Error('Google Maps DistanceMatrixService not available');
  }

  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins: [{ lat: origin.lat, lng: origin.lng }],
        destinations: [destinationAddress],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
        drivingOptions: {
          departureTime: new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS,
        },
      },
      (response, status) => {
        if (status !== google.maps.DistanceMatrixStatus.OK) {
          reject(new Error(`Distance Matrix API error: ${status}`));
          return;
        }

        const result = response?.rows[0]?.elements[0];
        if (!result || result.status !== 'OK') {
          reject(new Error('Unable to calculate route to destination'));
          return;
        }

        const duration = result.duration_in_traffic || result.duration;
        const durationMinutes = Math.ceil(duration.value / 60);

        resolve({
          durationMinutes,
          durationText: duration.text,
          distanceText: result.distance?.text || '',
          location: origin,
        });
      }
    );
  });
}
