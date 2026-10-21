// WP-03 (B1): checkout stability. One draft order per booking attempt (Back from Stripe, retries and double clicks reuse it), a processing
// state that resets when the page returns from the back/forward cache, a submit button that does not wait for a hidden question,
// actionable error text, and consents that are never pre-checked.
import { readFileSync } from 'node:fs';
import {
  BOOKING_ATTEMPT_KEY,
  STRIPE_URL_MAX_AGE_MS,
  bookingErrorMessage,
  clearBookingAttempt,
  decideAttempt,
  fingerprintBookingRequest,
  loadBookingAttempt,
  missingForSubmit,
  parseExpiry,
  rememberCreatedBooking,
  rememberStripeSession,
  stableStringify,
} from '../../booking/bookingAttempt';

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
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: map,
  };
}

// --- fingerprint ---------------------------------------------------------------------------------------------------------
eq('key order does not matter', stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }), stableStringify({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
eq('undefined fields are ignored', stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
const REQ: Record<string, unknown> = { contact: { email: 'a@b.co' }, items: [{ type: 'inflatable', unit_id: 'u1', qty: 1 }], payment: { selection_type: 'deposit', tip_cents: 0 } };
eq('same request same fingerprint', fingerprintBookingRequest(REQ), fingerprintBookingRequest(JSON.parse(JSON.stringify(REQ))));
eq('changed tip changes fingerprint', fingerprintBookingRequest(REQ) === fingerprintBookingRequest({ ...REQ, payment: { selection_type: 'deposit', tip_cents: 500 } }), false);
eq('changed item changes fingerprint', fingerprintBookingRequest(REQ) === fingerprintBookingRequest({ ...REQ, items: [{ type: 'inflatable', unit_id: 'u2', qty: 1 }] }), false);

// --- decisions -----------------------------------------------------------------------------------------------------------
const NOW = 1_800_000_000_000;
const FP = fingerprintBookingRequest(REQ);
eq('nothing remembered => new order', decideAttempt(null, FP, NOW), { action: 'new' });
const created = { fingerprint: FP, orderId: 'o1', bookingToken: 'tok', proofExpiresAt: NOW + 10 * 60_000, stripeUrl: null, stripeUrlAt: null };
eq('different request => new order', decideAttempt(created, 'other', NOW), { action: 'new' });
eq('Stripe step failed, proof alive => resume the same order', decideAttempt(created, FP, NOW), { action: 'resume', orderId: 'o1', bookingToken: 'tok' });
eq('proof about to expire => new order', decideAttempt({ ...created, proofExpiresAt: NOW + 30_000 }, FP, NOW), { action: 'new' });
eq('proof expired => new order', decideAttempt({ ...created, proofExpiresAt: NOW - 1 }, FP, NOW), { action: 'new' });
eq('unknown proof expiry still resumes', decideAttempt({ ...created, proofExpiresAt: null }, FP, NOW), { action: 'resume', orderId: 'o1', bookingToken: 'tok' });
eq('no token and no url => new order', decideAttempt({ ...created, bookingToken: null }, FP, NOW), { action: 'new' });
const withUrl = { fingerprint: FP, orderId: 'o1', bookingToken: null, proofExpiresAt: null, stripeUrl: 'https://checkout.stripe.com/c/pay/x', stripeUrlAt: NOW };
eq('live Stripe session => redirect back to it', decideAttempt(withUrl, FP, NOW + 60_000), { action: 'redirect', url: 'https://checkout.stripe.com/c/pay/x' });
eq('Stripe link just under the limit still redirects', decideAttempt(withUrl, FP, NOW + STRIPE_URL_MAX_AGE_MS - 1).action, 'redirect');
eq('old Stripe link => new order', decideAttempt(withUrl, FP, NOW + STRIPE_URL_MAX_AGE_MS), { action: 'new' });
eq('changed form with a live link => new order', decideAttempt(withUrl, 'other', NOW), { action: 'new' });
eq('clock going backwards does not redirect', decideAttempt(withUrl, FP, NOW - 5).action, 'new');
eq('parseExpiry ISO', parseExpiry('2030-01-01T00:00:00.000Z'), Date.parse('2030-01-01T00:00:00.000Z'));
eq('parseExpiry junk', parseExpiry('soon'), null);

// --- storage round trip --------------------------------------------------------------------------------------------------
const st = memoryStorage();
eq('empty storage', loadBookingAttempt(st), null);
rememberCreatedBooking(FP, { orderId: 'o9', bookingToken: 'secret-proof', expiresAt: '2030-01-01T00:00:00.000Z' }, st);
eq('created attempt stored with the proof', [loadBookingAttempt(st)?.orderId, loadBookingAttempt(st)?.bookingToken], ['o9', 'secret-proof']);
rememberStripeSession(FP, 'o9', 'https://checkout.stripe.com/c/pay/y', NOW, st);
const afterStripe = loadBookingAttempt(st);
eq('after the Stripe session the proof is dropped', [afterStripe?.bookingToken, afterStripe?.stripeUrl], [null, 'https://checkout.stripe.com/c/pay/y']);
eq('the proof is not left in storage text', (st.raw.get(BOOKING_ATTEMPT_KEY) || '').includes('secret-proof'), false);
clearBookingAttempt(st);
eq('cleared', loadBookingAttempt(st), null);
st.setItem(BOOKING_ATTEMPT_KEY, '{not json');
eq('corrupt storage is ignored', loadBookingAttempt(st), null);
st.setItem(BOOKING_ATTEMPT_KEY, JSON.stringify({ orderId: 5 }));
eq('malformed record is ignored', loadBookingAttempt(st), null);
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
eq('blocked storage does not throw', (() => { try { rememberCreatedBooking(FP, { orderId: 'o', bookingToken: 't' }, throwing); clearBookingAttempt(throwing); return loadBookingAttempt(throwing); } catch { return 'threw'; } })(), null);

// --- messages ------------------------------------------------------------------------------------------------------------
eq('INVALID_REQUEST is actionable', /review your quote/i.test(bookingErrorMessage('INVALID_REQUEST', 'Invalid booking request.')), true);
eq('availability codes keep the server wording', bookingErrorMessage('UNITS_UNAVAILABLE', 'Unit gone.'), 'Unit gone.');
eq('temporary failures say nothing was charged', /Nothing was charged/.test(bookingErrorMessage('CATALOG_UNAVAILABLE', null)), true);
eq('unknown code falls back to the server text', bookingErrorMessage('WHATEVER', 'Custom text'), 'Custom text');
eq('unknown everything has a default', /Nothing was charged/.test(bookingErrorMessage(null, null)), true);

// --- what is missing -----------------------------------------------------------------------------------------------------
eq('everything given => nothing missing', missingForSubmit({ cardOnFileConsent: true, smsConsent: true, howDidYouHearEnabled: true, referralSource: 'google' }), []);
eq('referral question off => referral not required', missingForSubmit({ cardOnFileConsent: true, smsConsent: true, howDidYouHearEnabled: false, referralSource: '' }), []);
eq('referral question on => referral required', missingForSubmit({ cardOnFileConsent: true, smsConsent: true, howDidYouHearEnabled: true, referralSource: '' }).map((m) => m.key), ['referral']);
eq('both consents missing, in form order', missingForSubmit({ cardOnFileConsent: false, smsConsent: false, howDidYouHearEnabled: false, referralSource: '' }).map((m) => m.key), ['card_on_file', 'sms']);

// --- page wiring (source) ------------------------------------------------------------------------------------------------
const summary = read('src/components/checkout/CheckoutSummary.tsx');
eq('button waits for the referral answer only when the question is shown', summary.includes('(referralRequired && !referralSource)') && !/!cardOnFileConsent \|\| !smsConsent \|\| !referralSource\}/.test(summary), true);
eq('summary lists what is missing', summary.includes('checkout-missing-items'), true);
const checkout = read('src/pages/Checkout.tsx');
eq('submit is guarded by an in-flight ref', checkout.includes('if (submitInFlightRef.current) return;') && checkout.includes('submitInFlightRef.current = true;'), true);
eq('pageshow (persisted) resets processing', /addEventListener\('pageshow'/.test(checkout) && /event\.persisted/.test(checkout), true);
eq('every failure path releases the in-flight ref', (checkout.match(/submitInFlightRef\.current = false;/g) || []).length >= 4, true);
eq('the request is fingerprinted and an attempt decision is made before creating a booking', checkout.indexOf('decideAttempt(') > 0 && checkout.indexOf('decideAttempt(') < checkout.indexOf('await createBooking('), true);
eq('a created booking is remembered and the Stripe session is remembered', checkout.includes('rememberCreatedBooking(fingerprint, created)') && checkout.includes('rememberStripeSession(fingerprint, booking.orderId, url, Date.now())'), true);
eq('referral is gated on the setting', checkout.includes('referralRequired={howDidYouHearEnabled}'), true);
const data = read('src/hooks/booking/useCheckoutData.ts');
eq('consents are not auto-checked', !/setSmsConsent\(true\)|setCardOnFileConsent\(true\)/.test(data), true);
const confirm = read('src/hooks/booking/useBookingReturnConfirmation.ts');
eq('completed booking clears the remembered attempt', confirm.includes('clearBookingAttempt();'), true);
const api = read('src/lib/booking/bookingApi.ts');
eq('startBookingCardSetup returns the session id as well', /Promise<\{ url: string; sessionId: string \| null \}>/.test(api), true);
eq('the card setup call still sends only the order id and proof, not money', /orderId: booking\.orderId,\s*bookingMode: true,\s*bookingToken: booking\.bookingToken,/.test(api), true);

console.log(`\nWP-03 checkout attempt tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
