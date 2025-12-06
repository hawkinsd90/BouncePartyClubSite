let isLoading = false;
let isLoaded = false;

export function loadGoogleMapsAPI(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.DistanceMatrixService) {
      isLoaded = true;
      resolve();
      return;
    }

    if (isLoading) {
      const checkInterval = setInterval(() => {
        if (window.google?.maps?.DistanceMatrixService) {
          isLoaded = true;
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!window.google?.maps?.DistanceMatrixService) {
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
        isLoaded = true;
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      isLoaded = true;
      isLoading = false;
      console.log('✅ Google Maps API loaded successfully');
      resolve();
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
  return Boolean(window.google?.maps?.DistanceMatrixService);
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

  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();

    service.getDistanceMatrix(
      {
        origins: [{ lat: origin.lat, lng: origin.lng }],
        destinations: [destinationAddress],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
        avoidHighways: false,
        avoidTolls: false,
      },
      (response, status) => {
        if (status !== 'OK') {
          reject(new Error(`Distance Matrix API error: ${status}`));
          return;
        }

        const result = response?.rows[0]?.elements[0];
        if (!result || result.status !== 'OK') {
          reject(new Error('Unable to calculate route to destination'));
          return;
        }

        const durationMinutes = Math.ceil(result.duration.value / 60);

        resolve({
          durationMinutes,
          durationText: result.duration.text,
          distanceText: result.distance.text,
          location: origin,
        });
      }
    );
  });
}
