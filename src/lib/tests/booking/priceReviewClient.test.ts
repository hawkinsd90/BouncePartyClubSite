// WP-17 (B2): the browser side of the price review. The request carries the price the customer was shown; a PRICE_CHANGED answer is surfaced
// with the server price; the Checkout page lets the customer accept it; the Quote page prices free cities from the same column as the server.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';

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

// bookingApi imports the Supabase browser client, which expects a browser; give it the smallest stand-in (nothing here talks to the network).
const memory = new Map<string, string>();
(globalThis as any).window = {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
  location: { href: 'http://localhost/', hash: '', search: '', origin: 'http://localhost' },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const INPUT: any = {
  quoteData: { event_date: '2030-01-01', start_window: '10:00', end_window: '14:00', pickup_preference: 'next_day', address_line1: '1 Main St', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83 },
  priceBreakdown: { travel_total_miles: 4 },
  cart: [{ item_type: 'inflatable', unit_id: 'u1', wet_or_dry: 'dry', qty: 1 }],
  contactData: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '5551234567' },
  billingAddress: { line1: '', city: '', state: '', zip: '' },
  billingSameAsEvent: true,
  smsConsent: true,
  cardOnFileConsent: true,
  paymentSelection: 'deposit',
  customPaymentCents: null,
  tipCents: 0,
  referralSource: null,
  referralSourceDetail: null,
};

let BookingApiError: any;
let buildBookingRequest: any;
let createBooking: any;

// createBooking against a stubbed network
const realFetch = (globalThis as any).fetch;
async function withFetch(response: { ok: boolean; status: number; body: any }, run: () => Promise<void>) {
  (globalThis as any).fetch = async () => ({ ok: response.ok, status: response.status, json: async () => response.body });
  try {
    await run();
  } finally {
    (globalThis as any).fetch = realFetch;
  }
}

(async () => {
  ({ BookingApiError, buildBookingRequest, createBooking } = await import('../../booking/bookingApi'));
  const withClaims = buildBookingRequest({ ...INPUT, claimedTotalCents: 25000, claimedDepositCents: 5000 }) as any;
  eq('claims are sent when provided', [withClaims.payment.claimed_total_cents, withClaims.payment.claimed_deposit_cents], [25000, 5000]);
  const withoutClaims = buildBookingRequest(INPUT) as any;
  eq('no claims are sent when not provided', 'claimed_total_cents' in withoutClaims.payment || 'claimed_deposit_cents' in withoutClaims.payment, false);
  eq('a zero claim is still a claim', (buildBookingRequest({ ...INPUT, claimedTotalCents: 0, claimedDepositCents: 0 }) as any).payment.claimed_total_cents, 0);
  await withFetch({ ok: false, status: 409, body: { success: false, error: 'The price changed.', code: 'PRICE_CHANGED', totals: { totalCents: 31000, depositCents: 6000 } } }, async () => {
    try {
      await createBooking({});
      eq('PRICE_CHANGED throws', true, false);
    } catch (e) {
      eq('PRICE_CHANGED is a BookingApiError with the code and the server price', [e instanceof BookingApiError, (e as any).code, (e as any).totals], [true, 'PRICE_CHANGED', { totalCents: 31000, depositCents: 6000 }]);
    }
  });
  await withFetch({ ok: false, status: 400, body: { success: false, error: 'bad', code: 'INVALID_REQUEST', totals: 'nonsense' } }, async () => {
    try {
      await createBooking({});
    } catch (e) {
      eq('malformed totals are ignored', (e as any).totals, null);
    }
  });
  await withFetch({ ok: true, status: 200, body: { success: true, orderId: 'o1', bookingToken: 't', expiresAt: '2030-01-01T00:00:00Z', totals: { totalCents: 100, depositCents: 50 } } }, async () => {
    const booking = await createBooking({});
    eq('success returns the server totals and expiry', [booking.orderId, booking.expiresAt, booking.totals], ['o1', '2030-01-01T00:00:00Z', { totalCents: 100, depositCents: 50 }]);
  });

  // WP-P1-06: the explanatory values on a PRICE_CHANGED answer
  await withFetch({ ok: false, status: 409, body: { success: false, error: 'x', code: 'PRICE_CHANGED', totals: { totalCents: 31000, depositCents: 6000 }, travelFeeCents: 2506, travelCityStatus: 'unverified' } }, async () => {
    try {
      await createBooking({});
    } catch (e) {
      eq('PRICE_CHANGED carries the delivery fee and city status next to the totals', (e as any).totals, { totalCents: 31000, depositCents: 6000, travelFeeCents: 2506, travelCityStatus: 'unverified' });
    }
  });
  await withFetch({ ok: false, status: 409, body: { success: false, error: 'x', code: 'PRICE_CHANGED', totals: { totalCents: 1, depositCents: 1 }, travelFeeCents: -5, travelCityStatus: '<b>x</b>' } }, async () => {
    try {
      await createBooking({});
    } catch (e) {
      eq('a malformed fee or an unknown status is ignored', (e as any).totals, { totalCents: 1, depositCents: 1 });
    }
  });
  const { explainPriceChange } = await import('../../booking/priceChangeExplanation');
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const T = (travelFeeCents?: number, travelCityStatus?: string) => ({ totalCents: 0, depositCents: 0, ...(travelFeeCents === undefined ? {} : { travelFeeCents }), ...(travelCityStatus ? { travelCityStatus } : {}) });
  const up = explainPriceChange(T(0), T(2506, 'unverified'), money);
  eq('unverified fee increase: delta, names the cause and says what to do', [up.travelFeeDeltaCents, /\$25\.06 higher/.test(up.sentence ?? ''), /could not automatically confirm/.test(up.sentence ?? ''), /contact us/.test(up.sentence ?? '')], [2506, true, true, true]);
  eq('mismatch fee increase names the free-delivery cities', /outside the free-delivery cities/.test(explainPriceChange(T(0), T(1200, 'verified_mismatch'), money).sentence ?? ''), true);
  eq('other fee increase states only the amount', explainPriceChange(T(0), T(1200, 'not_checked'), money), { sentence: 'The delivery fee is $12.00 higher than the quote showed.', travelFeeDeltaCents: 1200 });
  eq('fee decrease', explainPriceChange(T(1200), T(0, 'verified_match'), money), { sentence: 'The delivery fee is $12.00 lower than the quote showed.', travelFeeDeltaCents: -1200 });
  eq('no fee change: no sentence (the generic text stays)', explainPriceChange(T(500), T(500, 'unverified'), money), { sentence: null, travelFeeDeltaCents: 0 });
  eq('an unknown previous fee never invents a cause', explainPriceChange(T(), T(2506, 'unverified'), money), { sentence: null, travelFeeDeltaCents: null });

  // Page wiring
  const checkout = read('src/pages/Checkout.tsx');
  eq('Checkout sends the displayed total and deposit as claims', checkout.includes('claimedTotalCents: acceptedTotalsRef.current?.totalCents ?? unifiedTotals.totalCents') && checkout.includes('claimedDepositCents: acceptedTotalsRef.current?.depositCents ?? unifiedTotals.depositCents'), true);
  eq('Checkout shows the review on PRICE_CHANGED instead of an error toast', /error\.code === 'PRICE_CHANGED' && error\.totals\) \{\s*setPriceReview\(/.test(checkout), true);
  eq('accepting re-submits with the server price', checkout.includes('acceptedTotalsRef.current = priceReview.updated;') && checkout.includes('void handleSubmit();'), true);
  eq('reviewing the quote clears the accepted price', checkout.includes('acceptedTotalsRef.current = null;') && checkout.includes("navigate('/quote');"), true);
  const review = read('src/components/checkout/PriceChangedReview.tsx');
  eq('the review shows old and new total and deposit and says nothing was charged', ['Total shown before', 'New total', 'Deposit shown before', 'New deposit', 'Nothing has been charged'].every((t) => review.includes(t)), true);
  eq('the review dialog is accessible and scrollable on small screens', review.includes('role="alertdialog"') && review.includes('aria-modal="true"') && review.includes('max-h-[90dvh]') && review.includes('min-h-[44px]'), true);
  eq('source: the review shows the reason sentence and the delivery-fee change from the pure explanation', review.includes('explainPriceChange(previous, updated, formatCurrency)') && review.includes('price-change-reason') && review.includes('Delivery fee change'), true);
  eq('source: Checkout passes the delivery fee the customer was shown as the previous fee', checkout.includes('travelFeeCents: priceBreakdown.travel_fee_cents as number'), true);
  const quote = read('src/pages/Quote.tsx');
  eq('Quote reads the free-city list from included_cities first (the server rule)', quote.includes('(data.included_cities as string[] | null) ?? (data.included_city_list_json as string[] | null)'), true);

  console.log(`\nWP-17 client price review tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
