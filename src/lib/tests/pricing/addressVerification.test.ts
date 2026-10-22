// WP-18 (B2): the free-delivery city is decided from the server's verification of the street address, never from the typed city.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { matchesIncludedCity, normalizeCityName, calculateTravelFeeFromDistance } from '../../pricing/travelFeeCalculator';
import { shouldReuseSavedTravel } from '../../pricing/orderPricingCalculation';
import {
  MAX_CLIENT_COORDINATE_DRIFT_MILES,
  createGoogleAddressVerifier,
  interpretGeocode,
  resolveTrustedTravelCity,
  type AddressToVerify,
} from '../../../../supabase/functions/_shared/booking/addressVerification';

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

const FREE = ['Detroit', 'Hamtramck'];

// ---- city matching ----------------------------------------------------------------------------------------------------------
eq('normalize: case, spaces and periods', normalizeCityName('  St.  Clair   Shores '), 'st clair shores');
eq('match: exact', matchesIncludedCity('Detroit', FREE), true);
eq('match: case and spaces', matchesIncludedCity('  detroit ', FREE), true);
eq('match: another city', matchesIncludedCity('Shelby Township', FREE), false);
eq('match: empty city never matches', matchesIncludedCity('', FREE), false);
eq('match: empty list never matches', matchesIncludedCity('Detroit', []), false);
eq('fee function: a typed free city is free at any distance', calculateTravelFeeFromDistance({ distance_miles: 40, city: 'detroit', zip: '48201', baseRadiusMiles: 15, perMileAfterBaseCents: 300, includedCities: FREE, zoneOverrides: [] }).travel_fee_cents, 0);
eq('fee function: the empty city (unverified) pays the distance fee', calculateTravelFeeFromDistance({ distance_miles: 40, city: '', zip: '48315', baseRadiusMiles: 15, perMileAfterBaseCents: 300, includedCities: FREE, zoneOverrides: [] }).travel_fee_cents, 7500);
eq('fee function: a ZIP never makes anything free', calculateTravelFeeFromDistance({ distance_miles: 40, city: 'Utica', zip: '48201', baseRadiusMiles: 15, perMileAfterBaseCents: 300, includedCities: FREE, zoneOverrides: [] }).travel_fee_cents, 7500);
eq('fee function: a zone override still wins over a free city', calculateTravelFeeFromDistance({ distance_miles: 40, city: 'Detroit', zip: '48201', baseRadiusMiles: 15, perMileAfterBaseCents: 300, includedCities: FREE, zoneOverrides: [{ zip: '48201', flat_cents: 2000 }] }).travel_fee_cents, 2000);

// ---- geocode interpretation ------------------------------------------------------------------------------------------------
const ADDR: AddressToVerify = { line1: '100 Main St', city: 'Detroit', state: 'MI', zip: '48315', lat: 42.6, lng: -83.0 };
const comp = (long: string, types: string[], short = long) => ({ long_name: long, short_name: short, types });
function result(over: Record<string, unknown> = {}, city: string | null = 'Utica', state = 'MI') {
  return {
    status: 'OK',
    results: [
      {
        address_components: [
          comp('100', ['street_number']),
          comp('Main St', ['route']),
          ...(city ? [comp(city, ['locality', 'political'])] : [comp('Shelby Township', ['administrative_area_level_3', 'political'])]),
          comp('Michigan', ['administrative_area_level_1', 'political'], state),
          comp('48315', ['postal_code']),
        ],
        geometry: { location: { lat: 42.6, lng: -83.0 }, location_type: 'ROOFTOP' },
        ...over,
      },
    ],
  };
}
const atType = (location_type: string) => ({ geometry: { location: { lat: 42.6, lng: -83.0 }, location_type } });
eq('rooftop in another city => mismatch (typed Detroit ignored)', interpretGeocode(result(), ADDR, FREE), { status: 'verified_mismatch', city: 'Utica' });
eq('rooftop in a free city => match', interpretGeocode(result({}, 'Detroit'), ADDR, FREE), { status: 'verified_match', city: 'Detroit' });
eq('free city with different case => match', interpretGeocode(result({}, 'DETROIT'), ADDR, FREE).status, 'verified_match');
eq('range-interpolated is precise enough', interpretGeocode(result(atType('RANGE_INTERPOLATED'), 'Detroit'), ADDR, FREE).status, 'verified_match');
eq('partial match => unverified', interpretGeocode(result({ partial_match: true }, 'Detroit'), ADDR, FREE).status, 'unverified');
eq('approximate location => unverified', interpretGeocode(result(atType('APPROXIMATE'), 'Detroit'), ADDR, FREE).status, 'unverified');
eq('geometric center => unverified', interpretGeocode(result(atType('GEOMETRIC_CENTER'), 'Detroit'), ADDR, FREE).status, 'unverified');
eq('township without a locality => unverified, never a match', interpretGeocode(result({}, null), ADDR, FREE).status, 'unverified');
eq('other state => unverified', interpretGeocode(result({}, 'Detroit', 'OH'), ADDR, FREE).status, 'unverified');
eq('zero results => unverified', interpretGeocode({ status: 'ZERO_RESULTS', results: [] }, ADDR, FREE).status, 'unverified');
eq('over query limit => unverified', interpretGeocode({ status: 'OVER_QUERY_LIMIT', results: [] }, ADDR, FREE).status, 'unverified');
eq('null response => unverified', interpretGeocode(null, ADDR, FREE).status, 'unverified');
const far = { ...ADDR, lat: 42.6 + (MAX_CLIENT_COORDINATE_DRIFT_MILES + 0.3) / 69, lng: -83.0 };
eq('browser coordinates far from the geocode => unverified', interpretGeocode(result({}, 'Detroit'), far, FREE).status, 'unverified');
const near = { ...ADDR, lat: 42.6 + 0.2 / 69, lng: -83.0 };
eq('browser coordinates a little off are fine', interpretGeocode(result({}, 'Detroit'), near, FREE).status, 'verified_match');
eq('no browser coordinates (admin editors): no drift check', interpretGeocode(result({}, 'Detroit'), { ...ADDR, lat: null, lng: null }, FREE).status, 'verified_match');
eq('the ZIP never decides (wrong ZIP, right city still matches)', interpretGeocode(result({}, 'Detroit'), { ...ADDR, zip: '99999' }, FREE).status, 'verified_match');

// ---- which city may decide ---------------------------------------------------------------------------------------------------
eq('empty free list: nothing to verify, typed city passes through', resolveTrustedTravelCity(undefined, 'Detroit', []), { city: 'Detroit', review: null, status: 'not_checked' });
eq('match => the verified city', resolveTrustedTravelCity({ status: 'verified_match', city: 'Detroit' }, 'Utica', FREE), { city: 'Detroit', review: null, status: 'verified_match' });
eq('mismatch with a typed free city => no grant, flagged', resolveTrustedTravelCity({ status: 'verified_mismatch', city: 'Utica' }, 'Detroit', FREE), { city: 'Utica', review: 'typed_free_city_contradicted', status: 'verified_mismatch' });
eq('mismatch with a typed non-free city => no flag', resolveTrustedTravelCity({ status: 'verified_mismatch', city: 'Utica' }, 'Utica', FREE).review, null);
eq('unverified with a typed free city => no grant, flagged', resolveTrustedTravelCity({ status: 'unverified', reason: 'x' }, 'Detroit', FREE), { city: '', review: 'typed_free_city_not_verified', status: 'unverified' });
eq('no verifier result and a free list => no grant', resolveTrustedTravelCity(null, 'Detroit', FREE).city, '');
eq('no verifier result at all (undefined) with a free list => no grant', resolveTrustedTravelCity(undefined, 'Detroit', FREE).city, '');

(async () => {
  // ---- the Google client ---------------------------------------------------------------------------------------------------------
  const calls: string[] = [];
  const okFetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => result({}, 'Detroit') } as unknown as Response;
  }) as unknown as typeof fetch;
  const verifier = createGoogleAddressVerifier({ apiKey: 'KEY', fetchImpl: okFetch });
  eq('client: a good answer matches', (await verifier(ADDR, FREE))?.status, 'verified_match');
  const q = decodeURIComponent(calls[0] ?? '');
  eq('client: the typed city is not part of the query', calls.length === 1 && !q.includes('Detroit') && q.includes('100 Main St, MI 48315') && (calls[0] ?? '').includes('country%3AUS'), true);
  eq('client: no key => unverified without a request', [(await createGoogleAddressVerifier({ apiKey: '', fetchImpl: okFetch })(ADDR, FREE))?.status, calls.length], ['unverified', 1]);
  const httpErr = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
  eq('client: HTTP error => unverified', (await createGoogleAddressVerifier({ apiKey: 'K', fetchImpl: httpErr })(ADDR, FREE))?.status, 'unverified');
  const boom = (async () => {
    throw new Error('network');
  }) as unknown as typeof fetch;
  eq('client: network failure => unverified', (await createGoogleAddressVerifier({ apiKey: 'K', fetchImpl: boom })(ADDR, FREE))?.status, 'unverified');
  const hang = ((_url: string, init?: RequestInit) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        rej(e);
      });
    })) as unknown as typeof fetch;
  const t0 = Date.now();
  const timedOut = await createGoogleAddressVerifier({ apiKey: 'K', fetchImpl: hang, timeoutMs: 60 })(ADDR, FREE);
  eq('client: a slow geocoder times out => unverified', [timedOut?.status, Date.now() - t0 < 2000], ['unverified', true]);

  // ---- reuse of the stored travel snapshot -------------------------------------------------------------------------------------
  const ev = { address_line1: '1 Main St', address_city: 'Detroit', address_state: 'MI', address_zip: '48201' };
  const stored = (over: Record<string, unknown> = {}) =>
    ({ addresses: { line1: '1 Main St', city: 'Detroit', state: 'MI', zip: '48201' }, travel_fee_cents: 0, travel_per_mile_cents: 300, travel_base_radius_miles: 15, ...over }) as any;
  eq('reuse: stored $0 with its snapshot is reused', shouldReuseSavedTravel(ev, stored()), true);
  eq('reuse: stored $0 of a legacy order without the snapshot is not reused', shouldReuseSavedTravel(ev, stored({ travel_per_mile_cents: null, travel_base_radius_miles: null })), false);
  eq('reuse: stored positive fee still reused', shouldReuseSavedTravel(ev, stored({ travel_fee_cents: 1200 })), true);
  eq('reuse: address text compared without case/space noise', shouldReuseSavedTravel({ ...ev, address_line1: '  1  MAIN st ' }, stored()), true);
  eq('reuse: a real address change is not reused', shouldReuseSavedTravel({ ...ev, address_zip: '48202' }, stored()), false);
  eq('reuse: a new order is never reused', shouldReuseSavedTravel(ev, undefined), false);

  // ---- wiring (source) ----------------------------------------------------------------------------------------------------------
  const build = read('supabase/functions/_shared/booking/bookingBuild.ts');
  eq('the booking prices the free-city test with the trusted city', build.includes('city: travelCity.city,') && !/city: event\.address\.city,\s*zip: event\.address\.zip,\s*has_generator/.test(build), true);
  const create = read('supabase/functions/_shared/booking/createBooking.ts');
  eq('create-booking verifies once, before pricing, only when a free list exists', create.includes('includedCities.length > 0 && deps.verifyAddress') && create.indexOf('deps.verifyAddress(') < create.indexOf('buildBooking(parsed.value, catalog, now, verification)'), true);
  eq('the Edge Function wires the Google verifier with the server key', read('supabase/functions/create-booking/index.ts').includes('createGoogleAddressVerifier({ apiKey: Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "" })'), true);
  const staff = read('supabase/functions/_shared/orders/staff-order-save.ts');
  eq('staff save verifies only a new or changed address', staff.includes('if (existing && sameAddressText(e, existing.addresses)) return undefined;'), true);
  eq('staff save passes the verified city to the pricing engine on both paths', (staff.match(/verifiedTravelCity \}\)/g) || []).length === 2, true);
  eq('the engine never reads the typed city for the free test when a verified one is supplied', read('src/lib/pricing/orderPricingCalculation.ts').includes('resolved.verifiedTravelCity === undefined ? eventDetails.address_city'), true);

  console.log(`\nWP-18 address verification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
