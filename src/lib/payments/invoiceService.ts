import { getEdgeAuthToken } from '../core/edgeAuth';
import { callStaffOrderSave } from '../orders/staffOrderSaveApi';

// Creating an Admin / Crew invoice. The browser describes the invoice (customer, equipment, event, discounts, custom fees, waivers,
// an explicit deposit or Setup Fee override); the SERVER prices it and creates the draft order (staff-order-save, action
// create_invoice). No price, tax, total, deposit or balance computed in the browser is sent, and none would be accepted.

interface CartItem {
  unit_id: string;
  mode: 'dry' | 'water';
  // The staff member's own line price for this invoice (the "adjusted price"). It is an explicit input, bounded by the server.
  adjusted_price_cents: number;
  qty: number;
}

interface EventDetails {
  event_date: string;
  event_end_date: string;
  start_window: string;
  end_window: string;
  until_end_of_day: boolean;
  location_type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
  surface: string;
  generator_qty: number;
  pickup_preference: string;
  same_day_responsibility_accepted: boolean;
  overnight_responsibility_accepted: boolean;
}

interface Discount {
  name: string;
  amount_cents: number;
  percentage: number;
}

interface CustomFee {
  name: string;
  amount_cents: number;
}

interface EEProductItem {
  product_id: string | null;
  bundle_id?: string | null;
  item_name?: string;
  product_name: string;
  qty: number;
  unit_price_cents: number;
  pricing_context?: string;
  component_snapshot?: any;
}

export interface InvoiceData {
  customerId: string | null;
  cartItems: CartItem[];
  eeProductItems?: EEProductItem[];
  eventDetails: EventDetails;
  customDepositCents: number | null;
  customSetupFeeCents?: number | null;
  discounts: Discount[];
  customFees: CustomFee[];
  adminMessage: string;
  taxWaived?: boolean;
  taxWaiveReason?: string;
  travelFeeWaived?: boolean;
  travelFeeWaiveReason?: string;
  sameDayPickupFeeWaived?: boolean;
  sameDayPickupFeeWaiveReason?: string;
  surfaceFeeWaived?: boolean;
  surfaceFeeWaiveReason?: string | null;
  generatorFeeWaived?: boolean;
  generatorFeeWaiveReason?: string | null;
  sameDayWeekdayDeliveryFeeWaived?: boolean;
  sameDayWeekdayDeliveryFeeWaiveReason?: string;
  requireCardOnFile?: boolean;
}

export function buildInvoiceRequest(invoiceData: InvoiceData) {
  const waiver = (waived: boolean | undefined, reason: string | null | undefined) => ({ waived: !!waived, reason: reason ?? '' });
  const e = invoiceData.eventDetails;
  return {
    customerId: invoiceData.customerId,
    items: [
      ...invoiceData.cartItems.map((item) => ({ kind: 'inflatable', unit_id: item.unit_id, wet_or_dry: item.mode, qty: item.qty, unit_price_cents: item.adjusted_price_cents })),
      ...(invoiceData.eeProductItems || []).map((item) => ({
        kind: item.bundle_id ? 'bundle' : 'product', qty: item.qty,
        ...(item.bundle_id ? { bundle_id: item.bundle_id } : { product_id: item.product_id }),
      })),
    ],
    eventDetails: {
      event_date: e.event_date, event_end_date: e.event_end_date || e.event_date, start_window: e.start_window, end_window: e.end_window,
      until_end_of_day: e.until_end_of_day, location_type: e.location_type, surface: e.surface, generator_qty: e.generator_qty ?? 0, pickup_preference: e.pickup_preference,
      same_day_responsibility_accepted: e.same_day_responsibility_accepted, overnight_responsibility_accepted: e.overnight_responsibility_accepted,
      address_line1: e.address_line1, address_line2: e.address_line2 || '', city: e.city, state: e.state, zip: e.zip,
      ...(typeof e.lat === 'number' ? { lat: e.lat } : {}), ...(typeof e.lng === 'number' ? { lng: e.lng } : {}),
    },
    discounts: invoiceData.discounts.map((d) => ({ name: d.name, amount_cents: d.amount_cents || 0, percentage: Number(d.percentage || 0) })),
    customFees: invoiceData.customFees.map((f) => ({ name: f.name, amount_cents: f.amount_cents || 0 })),
    waivers: {
      tax: waiver(invoiceData.taxWaived, invoiceData.taxWaiveReason), travel: waiver(invoiceData.travelFeeWaived, invoiceData.travelFeeWaiveReason),
      surface: waiver(invoiceData.surfaceFeeWaived, invoiceData.surfaceFeeWaiveReason), generator: waiver(invoiceData.generatorFeeWaived, invoiceData.generatorFeeWaiveReason),
      same_day_pickup: waiver(invoiceData.sameDayPickupFeeWaived, invoiceData.sameDayPickupFeeWaiveReason),
      same_day_weekday_delivery: waiver(invoiceData.sameDayWeekdayDeliveryFeeWaived, invoiceData.sameDayWeekdayDeliveryFeeWaiveReason),
    },
    customDepositCents: invoiceData.customDepositCents,
    customSetupFeeCents: invoiceData.customSetupFeeCents ?? null,
    adminMessage: invoiceData.adminMessage,
    requireCardOnFile: invoiceData.requireCardOnFile !== false,
  };
}

interface Customer {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
}

async function sendInvoiceToCustomer(orderId: string, customer: Customer | null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invoice`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          // send-invoice is staff-only: send the signed-in admin's session token, not the public anon key.
          Authorization: `Bearer ${await getEdgeAuthToken()}`,
          'Content-Type': 'application/json',
        },
        // The deposit on the invoice is the order's own, stored deposit: the server reads it, the caller does not send one.
        body: JSON.stringify({
          orderId: orderId,
          customerEmail: customer?.email || null,
          customerPhone: customer?.phone || null,
          customerName: customer ? `${customer.first_name} ${customer.last_name}` : null,
        }),
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to send invoice');
  }

  return data;
}

export async function generateInvoice(invoiceData: InvoiceData, customer: Customer | null) {
  const eeItems = invoiceData.eeProductItems || [];
  for (const item of eeItems) {
    if (item.pricing_context !== 'standalone' && item.pricing_context !== 'addon') {
      throw new Error(
        `Cannot persist Event Essentials item "${item.item_name || item.product_name}": pricing_context is missing or invalid ("${item.pricing_context}").`
      );
    }
  }

  const created = await callStaffOrderSave<{ orderId: string }>('create_invoice', buildInvoiceRequest(invoiceData));
  const result = await sendInvoiceToCustomer(created.orderId, customer);

  return {
    order: { id: created.orderId },
    invoiceUrl: result.shortInvoiceUrl || result.invoiceUrl,
  };
}
