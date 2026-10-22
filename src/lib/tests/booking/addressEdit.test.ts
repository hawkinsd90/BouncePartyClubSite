// WP-04 (B1): editing the address text must discard the previously selected street and coordinates everywhere an address is typed.
// Pure helper checks plus source assertions on the four editors, the Quote validation gate and the prefill geocode.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import {
  ADMIN_ADDRESS_EDIT_RESET,
  QUOTE_ADDRESS_EDIT_RESET,
  SELECT_ADDRESS_MESSAGE,
  hasSelectedAddress,
  isPreciseGeocode,
} from '../../booking/addressEdit';
import { validateQuote } from '../../booking/quoteValidation';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

// --- pure helpers -----------------------------------------------------------------------------------------------------
ok('reset clears street and both coordinates', QUOTE_ADDRESS_EDIT_RESET.address_line1 === '' && QUOTE_ADDRESS_EDIT_RESET.lat === 0 && QUOTE_ADDRESS_EDIT_RESET.lng === 0);
ok('admin reset nulls lat, lng and county', ADMIN_ADDRESS_EDIT_RESET.address_lat === null && ADMIN_ADDRESS_EDIT_RESET.address_lng === null && ADMIN_ADDRESS_EDIT_RESET.address_county === null);
ok('selected address needs street and coordinates', hasSelectedAddress({ address_line1: '1 Main St', lat: 42.3, lng: -83 }));
ok('no street => not selected', !hasSelectedAddress({ address_line1: '', lat: 42.3, lng: -83 }));
ok('whitespace street => not selected', !hasSelectedAddress({ address_line1: '   ', lat: 42.3, lng: -83 }));
ok('zero lat => not selected', !hasSelectedAddress({ address_line1: '1 Main St', lat: 0, lng: -83 }));
ok('zero lng => not selected', !hasSelectedAddress({ address_line1: '1 Main St', lat: 42.3, lng: 0 }));
ok('NaN => not selected', !hasSelectedAddress({ address_line1: '1 Main St', lat: Number.NaN, lng: -83 }));
ok('after the edit reset the address is not selected', !hasSelectedAddress({ ...QUOTE_ADDRESS_EDIT_RESET }));

ok('rooftop geocode accepted', isPreciseGeocode({ geometry: { location_type: 'ROOFTOP' } }));
ok('interpolated geocode accepted', isPreciseGeocode({ geometry: { location_type: 'RANGE_INTERPOLATED' } }));
ok('city centroid (APPROXIMATE) rejected', !isPreciseGeocode({ geometry: { location_type: 'APPROXIMATE' } }));
ok('geometric center rejected', !isPreciseGeocode({ geometry: { location_type: 'GEOMETRIC_CENTER' } }));
ok('partial match rejected even when rooftop', !isPreciseGeocode({ partial_match: true, geometry: { location_type: 'ROOFTOP' } }));
ok('missing result rejected', !isPreciseGeocode(null) && !isPreciseGeocode(undefined) && !isPreciseGeocode({}));

// --- Quote validation blocks an unselected address --------------------------------------------------------------------------
const FORM: any = {
  event_date: '2030-01-01', event_end_date: '2030-01-01', start_window: '10:00', end_window: '14:00', until_end_of_day: false,
  address_line1: '1 Main St', address_line2: '', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83,
  location_type: 'residential', pickup_preference: 'same_day', same_day_responsibility_accepted: true, overnight_responsibility_accepted: false,
  can_stake: true, has_generator: false, generator_qty: 0, has_pets: false, special_details: '',
};
const CART: any = [{ unit_id: 'u1', unit_name: 'Castle', wet_or_dry: 'dry', unit_price_cents: 20000, qty: 1 }];
const good = validateQuote(CART, FORM);
ok('selected address passes the address gate', good.errorSection !== 'address');
const typed = validateQuote(CART, { ...FORM, ...QUOTE_ADDRESS_EDIT_RESET });
ok('edited address blocks submit', !typed.isValid && typed.errorSection === 'address' && typed.errorMessage === SELECT_ADDRESS_MESSAGE && typed.errorFieldId === 'address-input');
const noCoords = validateQuote(CART, { ...FORM, lat: 0, lng: 0 });
ok('street without coordinates blocks submit', !noCoords.isValid && noCoords.errorMessage === SELECT_ADDRESS_MESSAGE);

// --- the four editors clear the selection when text is typed ----------------------------------------------------------------
const section = read('src/components/quote/AddressSection.tsx');
ok('Quote AddressSection resets the selection on typing', /onChange=\{\(value\) => \{[\s\S]*?onFormDataChange\(QUOTE_ADDRESS_EDIT_RESET\)/.test(section));
const home = read('src/pages/Home.tsx');
ok('Home clears addressData on typing', /onChange=\{\(value\) => \{[\s\S]*?setAddressData\(null\)/.test(home));
const editor = read('src/components/order-detail/EventDetailsEditor.tsx');
ok('admin editor (both layouts) clears coordinates on typing', (editor.match(/onChange=\{\(value\) => onOrderChange\(\{ address_line1: value, \.\.\.ADMIN_ADDRESS_EDIT_RESET \}\)\}/g) || []).length === 2);
const form = read('src/hooks/booking/useQuoteForm.ts');
ok('city/ZIP centroid geocode removed', !/`\$\{formData\.city\}, \$\{formData\.state\} \$\{formData\.zip\}`/.test(form));
ok('prefill geocode uses the street address and a precision check', /address_line1\}, \$\{formData\.city\}/.test(form) && form.includes('isPreciseGeocode(result.results[0])'));
ok('geocode effect depends on the street', form.includes('[formData.address_line1, formData.city, formData.state, formData.zip, formData.lat, formData.lng]'));

// The canonical address upsert must never null out coordinates already stored when a geocode fails (plan WP-04 null-overwrite guard).
const addressService = read('src/lib/booking/addressService.ts');
ok('a failed geocode leaves stored lat/lng alone (columns omitted from the upsert)', addressService.includes('...(lat != null && lng != null ? { lat, lng } : {})') && !addressService.includes('lat: lat ?? null') && !addressService.includes('lng: lng ?? null'));

console.log(`\nWP-04 address edit tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
