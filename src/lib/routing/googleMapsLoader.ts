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
      // console.log('✅ Google Maps API loaded successfully with new loader');
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

export async function ensureGoogleMapsLoaded(): Promise<void> {
  await loadGoogleMapsAPI();

  if (window.google?.maps?.Geocoder) {
    return;
  }

  if (typeof google?.maps?.importLibrary === 'function') {
    await google.maps.importLibrary('geocoding');
  } else {
    throw new Error('Google Maps Geocoder not available after loading');
  }
}
