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
      existingScript.addEventListener('error', (e) => {
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
