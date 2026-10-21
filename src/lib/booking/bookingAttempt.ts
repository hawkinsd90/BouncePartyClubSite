// Remembers the last booking attempt of this browser tab so that pressing Back from Stripe, a second click, or a retry after a Stripe
// failure does not create another draft order for the same booking.
//
//   same request + live Stripe session  -> send the customer back to that Stripe session
//   same request + order exists, Stripe step failed (booking proof not yet consumed) -> start card setup again for the SAME order
//   anything else (form changed, proof expired, nothing remembered) -> create a new order
//
// The booking proof is kept only until Stripe returns a session URL (after that the proof is consumed server-side and is dropped here).
// Nothing is charged by any of this: the booking flow only saves a card.

export const BOOKING_ATTEMPT_KEY = 'bpc_booking_attempt';
/** A Stripe Checkout URL is reused for at most this long; after that a fresh order is created. */
export const STRIPE_URL_MAX_AGE_MS = 25 * 60 * 1000;
/** Do not resume with a proof that is about to expire. */
const PROOF_SAFETY_MS = 60 * 1000;

export interface BookingAttempt {
  fingerprint: string;
  orderId: string;
  /** Present only until the Stripe session exists. */
  bookingToken: string | null;
  /** ms epoch when the booking proof expires, or null when unknown. */
  proofExpiresAt: number | null;
  stripeUrl: string | null;
  stripeUrlAt: number | null;
}

export type AttemptDecision =
  | { action: 'new' }
  | { action: 'redirect'; url: string }
  | { action: 'resume'; orderId: string; bookingToken: string };

/** JSON with sorted keys, so equal requests always produce equal text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(',')}}`;
}

/** 53-bit string hash (cyrb53). Not a security control: it only recognises "the same request again". */
export function fingerprintBookingRequest(request: Record<string, unknown>): string {
  const text = stableStringify(request);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function decideAttempt(attempt: BookingAttempt | null, fingerprint: string, now: number): AttemptDecision {
  if (!attempt || attempt.fingerprint !== fingerprint) return { action: 'new' };
  if (attempt.stripeUrl && attempt.stripeUrlAt !== null && now - attempt.stripeUrlAt >= 0 && now - attempt.stripeUrlAt < STRIPE_URL_MAX_AGE_MS) {
    return { action: 'redirect', url: attempt.stripeUrl };
  }
  if (attempt.stripeUrl) return { action: 'new' }; // the Stripe session link is too old to trust
  if (!attempt.bookingToken) return { action: 'new' };
  if (attempt.proofExpiresAt !== null && now >= attempt.proofExpiresAt - PROOF_SAFETY_MS) return { action: 'new' };
  return { action: 'resume', orderId: attempt.orderId, bookingToken: attempt.bookingToken };
}

export function parseExpiry(expiresAt: unknown): number | null {
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) return expiresAt;
  if (typeof expiresAt === 'string') {
    const ms = Date.parse(expiresAt);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

// --- storage (sessionStorage, guarded: private windows and blocked storage must not break checkout) -------------------------------------

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function loadBookingAttempt(storage: StorageLike | null = defaultStorage()): BookingAttempt | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BOOKING_ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookingAttempt>;
    if (!parsed || typeof parsed.fingerprint !== 'string' || typeof parsed.orderId !== 'string') return null;
    return {
      fingerprint: parsed.fingerprint,
      orderId: parsed.orderId,
      bookingToken: typeof parsed.bookingToken === 'string' ? parsed.bookingToken : null,
      proofExpiresAt: typeof parsed.proofExpiresAt === 'number' ? parsed.proofExpiresAt : null,
      stripeUrl: typeof parsed.stripeUrl === 'string' ? parsed.stripeUrl : null,
      stripeUrlAt: typeof parsed.stripeUrlAt === 'number' ? parsed.stripeUrlAt : null,
    };
  } catch {
    return null;
  }
}

export function saveBookingAttempt(attempt: BookingAttempt, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(BOOKING_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // storage unavailable: the next submit simply creates a new order
  }
}

export function clearBookingAttempt(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOKING_ATTEMPT_KEY);
  } catch {
    // ignore
  }
}

/** The order was created; remember it (with the proof) so a retry of a failed Stripe step reuses it. */
export function rememberCreatedBooking(
  fingerprint: string,
  booking: { orderId: string; bookingToken: string; expiresAt?: unknown },
  storage: StorageLike | null = defaultStorage(),
): void {
  saveBookingAttempt(
    {
      fingerprint,
      orderId: booking.orderId,
      bookingToken: booking.bookingToken,
      proofExpiresAt: parseExpiry(booking.expiresAt),
      stripeUrl: null,
      stripeUrlAt: null,
    },
    storage,
  );
}

/** The Stripe session exists: remember its URL and drop the (now consumed) proof. */
export function rememberStripeSession(
  fingerprint: string,
  orderId: string,
  stripeUrl: string,
  now: number,
  storage: StorageLike | null = defaultStorage(),
): void {
  saveBookingAttempt(
    { fingerprint, orderId, bookingToken: null, proofExpiresAt: null, stripeUrl, stripeUrlAt: now },
    storage,
  );
}

// --- customer-facing error text -------------------------------------------------------------------------------------------------

/** Actionable text for the booking error codes (the server already words most of them; INVALID_REQUEST detail is deliberately withheld). */
export function bookingErrorMessage(code: string | null | undefined, serverMessage: string | null | undefined): string {
  switch (code) {
    case 'INVALID_REQUEST':
      return 'Some of the details in your booking need attention. Please review your quote, contact information and billing address, then try again.';
    case 'UNITS_UNAVAILABLE':
    case 'ITEMS_UNAVAILABLE':
    case 'DATE_BLACKED_OUT':
    case 'SAME_DAY_PICKUP_BLACKED_OUT':
      return serverMessage || 'Something in your cart is no longer available for the selected dates. Please return to your quote and review it.';
    case 'CATALOG_UNAVAILABLE':
    case 'AVAILABILITY_UNVERIFIABLE':
      return 'We could not verify availability just now. Nothing was charged. Please wait a moment and try again.';
    case 'CREATE_FAILED':
      return 'We could not create your booking. Nothing was charged. Please try again, or contact us if it keeps happening.';
    default:
      return serverMessage || 'We could not create your booking. Nothing was charged. Please try again or contact us for assistance.';
  }
}

export interface MissingItem {
  key: string;
  label: string;
}

/** What still stands between the customer and a submit, in the order the form shows it. */
export function missingForSubmit(input: {
  cardOnFileConsent: boolean;
  smsConsent: boolean;
  howDidYouHearEnabled: boolean;
  referralSource: string;
}): MissingItem[] {
  const missing: MissingItem[] = [];
  if (input.howDidYouHearEnabled && !input.referralSource) missing.push({ key: 'referral', label: 'Tell us how you heard about us' });
  if (!input.cardOnFileConsent) missing.push({ key: 'card_on_file', label: 'Agree to the card-on-file authorization' });
  if (!input.smsConsent) missing.push({ key: 'sms', label: 'Agree to SMS notifications' });
  return missing;
}
