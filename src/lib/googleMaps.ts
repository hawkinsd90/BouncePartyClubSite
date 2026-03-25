let loaderPromise: Promise<void> | null = null;

export function loadGoogleMapsAPI(): Promise<void> {
  if (typeof window.google?.maps?.importLibrary === 'function') {
    return Promise.resolve();
  }

  if (loaderPromise) {
    return loaderPromise;
  }

  loaderPromise = new Promise<void>((resolve, reject) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      loaderPromise = null;
      reject(new Error('Google Maps API key not configured'));
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    const scriptEl = existingScript as HTMLScriptElement | null;

    const onReady = () => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        if (typeof window.google?.maps?.importLibrary === 'function') {
          resolve();
        } else if (Date.now() > deadline) {
          loaderPromise = null;
          reject(new Error('Google Maps loading timeout'));
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    };

    if (scriptEl) {
      if (typeof window.google?.maps?.importLibrary === 'function') {
        resolve();
      } else if (scriptEl.dataset.loaded === 'true') {
        onReady();
      } else {
        scriptEl.addEventListener('load', onReady, { once: true });
        scriptEl.addEventListener('error', () => {
          loaderPromise = null;
          reject(new Error('Google Maps script failed to load'));
        }, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      console.log('✅ Google Maps API loaded successfully with new loader');
      onReady();
    };
    script.onerror = (e) => {
      loaderPromise = null;
      console.error('❌ Failed to load Google Maps API:', e);
      reject(new Error('Failed to load Google Maps API'));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
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
