// Tests for Quote form session persistence hydration/clearing rules.
//
// Exercises normalizeStoredQuoteForm and the FORM_STORAGE_VERSION logic:
//   - user-entered selections survive (version 2 preserves times)
//   - old generated 9AM/5PM values do NOT resurrect (pre-version-2 cleared)
//   - new/cleared session starts blank

import { normalizeStoredQuoteForm } from '../hooks/useQuoteForm';
import type { QuoteFormData } from '../hooks/useQuoteForm';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}: expected ${e}, got ${a}`); }
}

// Version 2 form preserves all user-entered fields including times
const v2Form: Partial<QuoteFormData> & { _version?: number } = {
  event_date: '2026-09-01',
  event_end_date: '2026-09-01',
  start_window: '14:00',
  end_window: '18:00',
  until_end_of_day: false,
  address_line1: '123 Main St',
  city: 'Detroit',
  state: 'MI',
  zip: '48201',
  location_type: 'residential',
  pickup_preference: 'next_day',
  same_day_responsibility_accepted: false,
  overnight_responsibility_accepted: true,
  can_stake: true,
  has_generator: false,
  generator_qty: 0,
  has_pets: true,
  special_details: 'Backyard access',
  _version: 2,
};

const restored = normalizeStoredQuoteForm(v2Form);
eq('v2 preserves start_window', restored.start_window, '14:00');
eq('v2 preserves end_window', restored.end_window, '18:00');
eq('v2 preserves address', restored.address_line1, '123 Main St');
eq('v2 preserves location_type', restored.location_type, 'residential');
eq('v2 preserves pickup_preference', restored.pickup_preference, 'next_day');
eq('v2 preserves overnight ack', restored.overnight_responsibility_accepted, true);
eq('v2 preserves can_stake', restored.can_stake, true);
eq('v2 preserves has_pets', restored.has_pets, true);
eq('v2 preserves special_details', restored.special_details, 'Backyard access');
eq('v2 preserves event_date', restored.event_date, '2026-09-01');
eq('v2 preserves event_end_date', restored.event_end_date, '2026-09-01');

// Pre-version-2 form: generated 9AM/5PM values are cleared
const oldForm: Partial<QuoteFormData> & { _version?: number } = {
  ...v2Form,
  start_window: '09:00',
  end_window: '17:00',
  _version: 1,
};

const oldRestored = normalizeStoredQuoteForm(oldForm);
eq('v1 clears start_window', oldRestored.start_window, '');
eq('v1 clears end_window', oldRestored.end_window, '');
// Non-time fields still preserved
eq('v1 preserves address', oldRestored.address_line1, '123 Main St');
eq('v1 preserves location_type', oldRestored.location_type, 'residential');

// No version: also clears times
const noVersionForm: Partial<QuoteFormData> & { _version?: number } = {
  ...v2Form,
  start_window: '09:00',
  end_window: '17:00',
};
delete noVersionForm._version;

const noVersionRestored = normalizeStoredQuoteForm(noVersionForm);
eq('no-version clears start_window', noVersionRestored.start_window, '');
eq('no-version clears end_window', noVersionRestored.end_window, '');

// Empty/null storage → blank time selections (simulated by caller)
const emptyRestored = normalizeStoredQuoteForm({});
eq('empty form has blank start_window', emptyRestored.start_window, '');
eq('empty form has blank end_window', emptyRestored.end_window, '');

console.log(`\nQuote form session persistence tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
