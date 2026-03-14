import { loadGoogleMapsAPI } from './googleMaps';

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
