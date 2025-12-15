import { supabase } from './supabase';
import type { PriceBreakdown } from './pricing';

interface CartItem {
  unit_id: string;
  mode: 'dry' | 'water';
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

interface InvoiceData {
  customerId: string | null;
  cartItems: CartItem[];
  eventDetails: EventDetails;
  priceBreakdown: PriceBreakdown | null;
  subtotal: number;
  taxCents: number;
  depositRequired: number;
  totalCents: number;
  customDepositCents: number | null;
  discounts: Discount[];
  customFees: CustomFee[];
  adminMessage: string;
}

async function createAddress(eventDetails: EventDetails) {
  const { data, error } = await supabase
    .from('addresses')
    .insert({
      line1: eventDetails.address_line1,
      line2: eventDetails.address_line2,
      city: eventDetails.city,
      state: eventDetails.state,
      zip: eventDetails.zip,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createOrder(
  customerId: string | null,
  addressId: string,
  eventDetails: EventDetails,
  priceBreakdown: PriceBreakdown | null,
  subtotal: number,
  taxCents: number,
  depositRequired: number,
  totalCents: number,
  customDepositCents: number | null,
  adminMessage: string
) {
  const { data, error } = await supabase
    .from('orders')
    .insert({
      customer_id: customerId,
      address_id: addressId,
      event_date: eventDetails.event_date,
      event_end_date: eventDetails.event_end_date || eventDetails.event_date,
      start_date: eventDetails.event_date,
      end_date: eventDetails.event_end_date || eventDetails.event_date,
      start_window: eventDetails.start_window,
      end_window: eventDetails.end_window,
      until_end_of_day: eventDetails.until_end_of_day,
      location_type: eventDetails.location_type,
      surface: eventDetails.surface,
      generator_qty: eventDetails.generator_qty,
      pickup_preference: eventDetails.pickup_preference,
      same_day_responsibility_accepted: eventDetails.same_day_responsibility_accepted,
      overnight_responsibility_accepted: eventDetails.overnight_responsibility_accepted,
      subtotal_cents: priceBreakdown?.subtotal_cents || subtotal,
      travel_fee_cents: priceBreakdown?.travel_fee_cents || 0,
      travel_total_miles: priceBreakdown?.travel_total_miles || 0,
      travel_base_radius_miles: priceBreakdown?.travel_base_radius_miles || 0,
      travel_chargeable_miles: priceBreakdown?.travel_chargeable_miles || 0,
      travel_per_mile_cents: priceBreakdown?.travel_per_mile_cents || 0,
      travel_is_flat_fee: priceBreakdown?.travel_is_flat_fee || false,
      surface_fee_cents: priceBreakdown?.surface_fee_cents || 0,
      same_day_pickup_fee_cents: priceBreakdown?.same_day_pickup_fee_cents || 0,
      generator_fee_cents: priceBreakdown?.generator_fee_cents || 0,
      tax_cents: taxCents,
      deposit_due_cents: depositRequired,
      balance_due_cents: totalCents - depositRequired,
      custom_deposit_cents: customDepositCents,
      status: 'draft',
      card_on_file_consent: false,
      sms_consent: false,
      admin_message: adminMessage || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createOrderItems(orderId: string, cartItems: CartItem[]) {
  const orderItems = cartItems.map(item => ({
    order_id: orderId,
    unit_id: item.unit_id,
    qty: item.qty,
    wet_or_dry: item.mode,
    unit_price_cents: item.adjusted_price_cents,
  }));

  const { error } = await supabase.from('order_items').insert(orderItems);

  if (error) throw error;
}

async function createOrderDiscounts(orderId: string, discounts: Discount[]) {
  if (discounts.length === 0) return;

  const orderDiscounts = discounts.map(d => ({
    order_id: orderId,
    name: d.name,
    amount_cents: d.amount_cents,
    percentage: d.percentage,
  }));

  const { error } = await supabase.from('order_discounts').insert(orderDiscounts);

  if (error) throw error;
}

async function createOrderCustomFees(orderId: string, customFees: CustomFee[]) {
  if (customFees.length === 0) return;

  const orderFees = customFees.map(f => ({
    order_id: orderId,
    name: f.name,
    amount_cents: f.amount_cents,
  }));

  const { error } = await supabase.from('order_custom_fees').insert(orderFees);

  if (error) throw error;
}

async function sendInvoiceToCustomer(
  orderId: string,
  depositRequired: number,
  customer: any | null
) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invoice`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: orderId,
        depositCents: depositRequired,
        customerEmail: customer?.email || null,
        customerPhone: customer?.phone || null,
        customerName: customer ? `${customer.first_name} ${customer.last_name}` : null,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to send invoice');
  }

  return data;
}

export async function generateInvoice(invoiceData: InvoiceData, customer: any | null) {
  const address = await createAddress(invoiceData.eventDetails);

  const order = await createOrder(
    invoiceData.customerId,
    address.id,
    invoiceData.eventDetails,
    invoiceData.priceBreakdown,
    invoiceData.subtotal,
    invoiceData.taxCents,
    invoiceData.depositRequired,
    invoiceData.totalCents,
    invoiceData.customDepositCents,
    invoiceData.adminMessage
  );

  await createOrderItems(order.id, invoiceData.cartItems);
  await createOrderDiscounts(order.id, invoiceData.discounts);
  await createOrderCustomFees(order.id, invoiceData.customFees);

  const result = await sendInvoiceToCustomer(order.id, invoiceData.depositRequired, customer);

  return {
    order,
    invoiceUrl: result.invoiceUrl,
  };
}
