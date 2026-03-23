// BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
// Restore only after a true dev/staging environment and explicit safe gating are in place.
// This entire file is a dev/QA utility that:
//   1. Contains hardcoded PII (real name, email, phone) — replaced below with fake data.
//   2. Writes directly to production Supabase tables via the anon client.
//   3. Logs verbose pricing/cart details to the browser console.
// The exported function is referenced in Home.tsx and should remain importable so the
// build does not break, but it is a no-op stub until dev gating is in place.

// import { supabase } from './supabase';
// import { addDays, format } from 'date-fns';
// import { calculateDistance, calculateDrivingDistance, calculatePrice } from './pricing';
// import { loadGoogleMapsAPI } from './googleMaps';
// import { SafeStorage } from './safeStorage';

// BPC-SECURITY-HARDENING: Original PII replaced with clearly fake placeholder data.
// const DEVON_CONTACT = {
//   first_name: 'Test',
//   last_name: 'User',
//   email: 'test-user@example.com',
//   phone: '5550000000',
// };

// const HOME_BASE = {
//   latitude: 42.2812,
//   longitude: -83.3755,
//   address: '4426 Woodward St, Wayne, MI 48184'
// };

// const REMOTE_ADDRESSES = [
//   {
//     formatted_address: '123 Main St, Ann Arbor, MI 48104',
//     street_address: '123 Main St',
//     city: 'Ann Arbor',
//     state: 'MI',
//     zip_code: '48104',
//     latitude: 42.2808,
//     longitude: -83.7430,
//   },
//   {
//     formatted_address: '456 Oak Ave, Ypsilanti, MI 48197',
//     street_address: '456 Oak Ave',
//     city: 'Ypsilanti',
//     state: 'MI',
//     zip_code: '48197',
//     latitude: 42.2411,
//     longitude: -83.6130,
//   },
//   {
//     formatted_address: '789 Elm Rd, Canton, MI 48188',
//     street_address: '789 Elm Rd',
//     city: 'Canton',
//     state: 'MI',
//     zip_code: '48188',
//     latitude: 42.3087,
//     longitude: -83.4819,
//   },
// ];

// async function findAvailableUnits(date: string, count: number = 2) { ... }
// async function findAvailableDate() { ... }

export async function createTestBooking() {
  // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
  // Restore only after a true dev/staging environment and explicit safe gating are in place.
  console.warn('[TEST BOOKING] createTestBooking() is disabled in production.');
  return { success: false, error: 'Test booking is disabled in production.' };
}
