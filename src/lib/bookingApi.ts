// Browser client for the public booking boundary (Payment Safety A2.3).
//
// The browser describes what the customer chose and receives results. It never writes customers, addresses, orders,
// order_items or consent_records, never reads other bookings, and never sends a price, deposit, status, customer id or
// address id (the server ignores or rejects them). Prices shown on the Checkout page are for display only; the order
// is priced by the create-booking Edge Function from the live catalog.

/* eslint-disable @typescript-eslint/no-explicit-any */
// (quoteData / priceBreakdown are untyped localStorage JSON from the Quote page; function responses are untyped JSON)

import { supabase } from './supabase';
import type { UnifiedCartItem } from '../types';

const functionsUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// A signed-in customer's token lets the server recognise them (so a guest cannot overwrite their profile); everyone
// else uses the public anon key, which proves nothing.
async function bearer(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
  } catch {
    // fall through to the anon key
  }
  return import.meta.env.VITE_SUPABASE_ANON_KEY as string;
}

async function post<T>(fn: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  const response = await fetch(`${functionsUrl()}/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await bearer()}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, data };
}

export interface BookingIntentInput {
  quoteData: any;
  priceBreakdown: any;
  cart: UnifiedCartItem[];
  contactData: { first_name: string; last_name: string; email: string; phone: string; business_name?: string };
  billingAddress: { line1: string; line2?: string; city: string; state: string; zip: string };
  billingSameAsEvent: boolean;
  smsConsent: boolean;
  cardOnFileConsent: boolean;
  paymentSelection: 'deposit' | 'full' | 'custom';
  customPaymentCents: number | null;
  tipCents: number;
  referralSource: string | null;
  referralSourceDetail: string | null;
}

// Pure: turns the Checkout page state into the create-booking request. Items carry identity and quantity only.
export function buildBookingRequest(input: BookingIntentInput): Record<string, unknown> {
  const { quoteData, cart } = input;
  const items = cart.map((item) => {
    if (item.item_type === 'event_essential_product') {
      return { type: 'product', product_id: item.product_id, qty: item.qty };
    }
    if (item.item_type === 'event_essential_bundle') {
      return { type: 'bundle', bundle_id: item.bundle_id, qty: item.qty };
    }
    return { type: 'inflatable', unit_id: item.unit_id, wet_or_dry: item.wet_or_dry, qty: item.qty };
  });

  const request: Record<string, unknown> = {
    contact: {
      first_name: input.contactData.first_name,
      last_name: input.contactData.last_name,
      email: input.contactData.email,
      phone: input.contactData.phone,
      business_name: input.contactData.business_name || null,
    },
    event: {
      event_date: quoteData.event_date,
      event_end_date: quoteData.event_end_date || quoteData.event_date,
      start_window: quoteData.start_window,
      end_window: quoteData.end_window,
      until_end_of_day: quoteData.until_end_of_day === true,
      location_type: quoteData.location_type ?? 'residential',
      pickup_preference: quoteData.pickup_preference,
      can_stake: typeof quoteData.can_stake === 'boolean' ? quoteData.can_stake : null,
      special_details: quoteData.special_details || null,
      same_day_responsibility_accepted: quoteData.same_day_responsibility_accepted === true,
      overnight_responsibility_accepted: quoteData.overnight_responsibility_accepted === true,
      // The one measured value the server cannot recompute; it only feeds the travel fee and is bounded server-side.
      distance_miles: Number(input.priceBreakdown?.travel_total_miles),
      address: {
        line1: quoteData.address_line1,
        line2: quoteData.address_line2 || null,
        city: quoteData.city,
        state: quoteData.state,
        zip: quoteData.zip,
        lat: quoteData.lat ?? null,
        lng: quoteData.lng ?? null,
      },
    },
    billing: input.billingSameAsEvent
      ? { same_as_event: true }
      : {
          same_as_event: false,
          address: {
            line1: input.billingAddress.line1,
            line2: input.billingAddress.line2 || null,
            city: input.billingAddress.city,
            state: input.billingAddress.state,
            zip: input.billingAddress.zip,
          },
        },
    items,
    consents: { sms: input.smsConsent, card_on_file: input.cardOnFileConsent },
    payment: {
      selection_type: input.paymentSelection,
      ...(input.paymentSelection === 'custom' ? { selection_cents: input.customPaymentCents } : {}),
      tip_cents: input.tipCents,
    },
    referral: { source: input.referralSource || null, detail: input.referralSourceDetail || null },
  };
  return request;
}

export class BookingApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
  }
}

export interface CreatedBooking {
  orderId: string;
  bookingToken: string;
}

export async function createBooking(request: Record<string, unknown>): Promise<CreatedBooking> {
  const { ok, data } = await post<{ orderId?: string; bookingToken?: string }>('create-booking', request);
  if (!ok || !data.orderId || !data.bookingToken) {
    throw new BookingApiError(data.error || 'We could not create your booking. Please try again.', data.code ?? null);
  }
  return { orderId: data.orderId, bookingToken: data.bookingToken };
}

// Starts the Stripe card-SAVE (setup-mode) session. Nothing is charged. The server reads the customer, deposit and tip
// from the order; only the order id, the booking proof and the return origin are sent.
export async function startBookingCardSetup(booking: CreatedBooking): Promise<string> {
  const { ok, data } = await post<{ url?: string }>('stripe-checkout', {
    orderId: booking.orderId,
    bookingMode: true,
    bookingToken: booking.bookingToken,
    origin: window.location.origin,
  });
  if (!ok || !data.url) {
    throw new Error(data.error || 'Failed to create checkout session');
  }
  return data.url;
}

export interface CompletedBooking {
  order: any;
  isAdminInvoice: boolean;
  tipCents: number;
}

export async function loadCompletedBooking(orderId: string, sessionId: string): Promise<CompletedBooking | null> {
  const { ok, data } = await post<Partial<CompletedBooking & { order: any }>>('complete-booking', { orderId, sessionId, action: 'details' });
  if (!ok || !data.order) return null;
  return {
    order: data.order,
    isAdminInvoice: data.isAdminInvoice === true,
    tipCents: typeof data.tipCents === 'number' ? data.tipCents : 0,
  };
}

export async function markBookingConfirmationSent(orderId: string, sessionId: string): Promise<boolean> {
  const { ok } = await post('complete-booking', { orderId, sessionId, action: 'mark_confirmation_sent' });
  return ok;
}

export interface UnitAvailabilityCheck {
  unitId: string;
  eventStartDate: string;
  eventEndDate: string;
}

const AVAILABILITY_CHUNK = 50;

// Public inflatable availability: true/false per unit. No order, customer or address information comes back.
export async function checkUnitsAvailabilityPublic(checks: UnitAvailabilityCheck[]): Promise<Array<{ unitId: string; isAvailable: boolean }>> {
  const out: Array<{ unitId: string; isAvailable: boolean }> = [];
  for (let i = 0; i < checks.length; i += AVAILABILITY_CHUNK) {
    const chunk = checks.slice(i, i + AVAILABILITY_CHUNK);
    const { ok, data } = await post<{ results?: Array<{ unitId: string; isAvailable: boolean }> }>('check-availability', { checks: chunk });
    if (!ok || !Array.isArray(data.results)) {
      // Fail closed: if availability cannot be verified, nothing is reported as available.
      out.push(...chunk.map((c) => ({ unitId: c.unitId, isAvailable: false })));
    } else {
      out.push(...data.results);
    }
  }
  return out;
}
