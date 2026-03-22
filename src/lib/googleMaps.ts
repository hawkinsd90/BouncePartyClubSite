let isLoading = false;

export function loadGoogleMapsAPI(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if the new API with importLibrary is available
    if (typeof window.google?.maps?.importLibrary === 'function') {
      resolve();
      return;
    }

    if (isLoading) {
      const checkInterval = setInterval(() => {
        if (typeof window.google?.maps?.importLibrary === 'function') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!window.google?.maps?.importLibrary) {
          reject(new Error('Google Maps loading timeout'));
        }
      }, 10000);
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error('Google Maps API key not configured'));
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        isLoading = false;
        resolve();
      });
      existingScript.addEventListener('error', () => {
        isLoading = false;
        reject(new Error('Google Maps script failed to load'));
      });
      return;
    }

    isLoading = true;

    const script = document.createElement('script');
    // Use the new API loader with v=weekly to get importLibrary support
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      isLoading = false;
      console.log('✅ Google Maps API loaded successfully with new loader');

      // Wait for importLibrary to be available
      const waitForImportLibrary = () => {
        if (typeof window.google?.maps?.importLibrary === 'function') {
          resolve();
        } else {
          setTimeout(waitForImportLibrary, 50);
        }
      };
      waitForImportLibrary();
    };
    script.onerror = (e) => {
      isLoading = false;
      console.error('❌ Failed to load Google Maps API:', e);
      reject(new Error('Failed to load Google Maps API'));
    };
    document.head.appendChild(script);
  });
}

export function isGoogleMapsLoaded(): boolean {
  return Boolean(window.google?.maps?.importLibrary);
}

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

  if (typeof google.maps.importLibrary !== 'function') {
    throw new Error('Google Maps importLibrary not available');
  }

  const routesLib = await google.maps.importLibrary("routes") as any;
  const DistanceMatrixService = routesLib.DistanceMatrixService;

  return new Promise((resolve, reject) => {
    const service = new DistanceMatrixService();

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
      (response: any, status: string) => {
        if (status !== 'OK') {
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
          distanceText: result.distance.text,
          location: origin,
        });
      }
    );
  });
}
