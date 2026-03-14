import { loadGoogleMapsAPI } from './googleMaps';

let geocodingLoaded = false;

export async function ensureGoogleMapsLoaded(): Promise<void> {
  await loadGoogleMapsAPI();

  if (geocodingLoaded) return;

  if (typeof google?.maps?.importLibrary === 'function') {
    await google.maps.importLibrary('geocoding');
    geocodingLoaded = true;
  } else {
    if (!window.google?.maps?.Geocoder) {
      throw new Error('Google Maps Geocoder not available after loading');
    }
    geocodingLoaded = true;
  }
}
