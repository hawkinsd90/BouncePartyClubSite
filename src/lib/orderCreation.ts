import { supabase } from './supabase';
import { checkMultipleUnitsAvailability, checkDateBlackout } from './availability';
import { formatOrderId } from './utils';
import { upsertCanonicalAddress } from './addressService';

interface OrderData {
  contactData: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    business_name?: string;
  };
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  billingAddress: any;
  billingSameAsEvent: boolean;
  smsConsent: boolean;
  cardOnFileConsent: boolean;
  customerSelectedPaymentCents?: number;
  customerSelectedPaymentType?: 'deposit' | 'full' | 'custom';
  tipCents?: number;
}

export async function createOrderBeforePayment(data: OrderData): Promise<string> {
  const {
    contactData,
    quoteData,
    priceBreakdown,
    cart,
    billingAddress,
    billingSameAsEvent,
    smsConsent,
    cardOnFileConsent,
    customerSelectedPaymentCents,
    customerSelectedPaymentType,
    tipCents = 0,
  } = data;

  // Fetch the current pricing rules to check apply_taxes_by_default setting
  const { data: pricingRulesData } = await supabase
    .from('pricing_rules')
    .select('apply_taxes_by_default')
    .limit(1)
    .maybeSingle();

  const applyTaxesByDefault = pricingRulesData?.apply_taxes_by_default ?? true;

  // 0a. CLIENT-SIDE EARLY REJECTION: Check blackout dates before writing anything to the DB.
  // NOTE: This is browser code and can be bypassed. The trusted enforcement gate is in
  // the stripe-checkout edge function. This check exists only to reduce orphaned draft orders.
  const blackout = await checkDateBlackout(quoteData.event_date, quoteData.event_end_date || quoteData.event_date);
  if (blackout.is_full_blocked) {
    throw new Error('This date is not available for booking. Please contact us or choose a different date.');
  }
  const isSameDayOrder =
    quoteData.pickup_preference === 'same_day' || quoteData.location_type === 'commercial';
  if (blackout.is_same_day_pickup_blocked && isSameDayOrder) {
    throw new Error('Same-day pickups are not available for this date. Please choose next-day pickup or select a different date.');
  }

  // 0b. CRITICAL SAFETY CHECK: Verify unit availability before creating order
  const availabilityChecks = cart.map(item => ({
    unitId: item.unit_id,
    eventStartDate: quoteData.event_date,
    eventEndDate: quoteData.event_end_date,
  }));

  const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
  const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

  if (unavailableUnits.length > 0) {
    const unitNames = unavailableUnits.map(u => {
      const cartItem = cart.find(item => item.unit_id === u.unitId);
      return cartItem?.unit_name || 'Unknown unit';
    }).join(', ');

    throw new Error(
      `Cannot create order: The following units are not available for the selected dates: ${unitNames}. Please select different units or dates.`
    );
  }

  // 1. Create or update customer
  let customer;
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .eq('email', contactData.email)
    .maybeSingle();

  if (existingCustomer) {
    const { data: updatedCustomer, error: updateError } = await supabase
      .from('customers')
      .update({
        first_name: contactData.first_name,
        last_name: contactData.last_name,
        phone: contactData.phone,
      })
      .eq('id', existingCustomer.id)
      .select()
      .single();

    if (updateError) throw updateError;
    customer = updatedCustomer;
  } else {
    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert({
        first_name: contactData.first_name,
        last_name: contactData.last_name,
        email: contactData.email,
        phone: contactData.phone,
        business_name: contactData.business_name || null,
      })
      .select()
      .single();

    if (customerError) throw customerError;
    customer = newCustomer;
  }

  // 2. Create or update contact
  const { error: contactError } = await supabase.from('contacts').upsert(
    {
      first_name: contactData.first_name,
      last_name: contactData.last_name,
      email: contactData.email,
      phone: contactData.phone,
      business_name: contactData.business_name || null,
      source: 'booking',
      opt_in_email: true,
      opt_in_sms: smsConsent,
    },
    {
      onConflict: 'email',
    }
  );

  if (contactError) {
    console.error('Error creating contact:', contactError);
  }

  // 3. Create or reuse canonical address
  const rawAddr = billingSameAsEvent
    ? {
        line1: quoteData.address_line1,
        line2: quoteData.address_line2 || null,
        city: quoteData.city,
        state: quoteData.state,
        zip: quoteData.zip,
        lat: quoteData.lat || null,
        lng: quoteData.lng || null,
      }
    : billingAddress;

  const address = await upsertCanonicalAddress({
    customer_id: customer.id,
    line1: rawAddr.line1,
    line2: rawAddr.line2 || null,
    city: rawAddr.city,
    state: rawAddr.state,
    zip: rawAddr.zip,
    lat: rawAddr.lat ?? null,
    lng: rawAddr.lng ?? null,
  });

  // 4. Create order with 'draft' status (unpaid invoice)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      status: 'draft',
      location_type: quoteData.location_type,
      surface: quoteData.can_stake ? 'grass' : 'cement',
      event_date: quoteData.event_date,
      event_end_date: quoteData.event_end_date || quoteData.event_date,
      pickup_preference: quoteData.pickup_preference || (quoteData.location_type === 'commercial' ? 'same_day' : 'next_day'),
      start_window: quoteData.start_window,
      end_window: quoteData.end_window,
      until_end_of_day: quoteData.until_end_of_day || false,
      same_day_responsibility_accepted: quoteData.same_day_responsibility_accepted || false,
      overnight_responsibility_accepted: quoteData.overnight_responsibility_accepted || false,
      generator_qty: quoteData.generator_qty || 0,
      address_id: address.id,
      subtotal_cents: priceBreakdown.subtotal_cents,
      travel_fee_cents: priceBreakdown.travel_fee_cents,
      travel_total_miles: priceBreakdown.travel_total_miles,
      travel_base_radius_miles: priceBreakdown.travel_base_radius_miles,
      travel_chargeable_miles: priceBreakdown.travel_chargeable_miles,
      travel_per_mile_cents: priceBreakdown.travel_per_mile_cents,
      travel_is_flat_fee: priceBreakdown.travel_is_flat_fee,
      surface_fee_cents: priceBreakdown.surface_fee_cents,
      same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents || 0,
      generator_fee_cents: priceBreakdown.generator_fee_cents || 0,
      tax_cents: applyTaxesByDefault ? priceBreakdown.tax_cents : 0,
      tax_waived: false,
      tax_waive_reason: null,
      travel_fee_waived: false,
      travel_fee_waive_reason: null,
      same_day_pickup_fee_waived: false,
      same_day_pickup_fee_waive_reason: null,
      tip_cents: tipCents,
      deposit_due_cents: customerSelectedPaymentCents || priceBreakdown.deposit_due_cents,
      deposit_paid_cents: 0,
      balance_due_cents: applyTaxesByDefault
        ? Math.max(0, priceBreakdown.total_cents - (customerSelectedPaymentCents || priceBreakdown.deposit_due_cents))
        : Math.max(0, (priceBreakdown.total_cents - priceBreakdown.tax_cents) - (customerSelectedPaymentCents || priceBreakdown.deposit_due_cents)),
      custom_deposit_cents: null,
      customer_selected_payment_cents: customerSelectedPaymentCents || priceBreakdown.deposit_due_cents,
      customer_selected_payment_type: customerSelectedPaymentType || 'deposit',
      card_on_file_consent: cardOnFileConsent,
      admin_message: null,
      booking_confirmation_sent: false,
      cancellation_reason: null,
      sms_consent_text:
        'I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.',
      sms_consented_at: smsConsent ? new Date().toISOString() : null,
      sms_consent: smsConsent,
      special_details: quoteData.special_details || null,
    })
    .select()
    .single();

  if (orderError) throw orderError;

  // 5. Create order items
  for (const item of cart) {
    // console.log('Creating order item:', {
    //   order_id: order.id,
    //   unit_id: item.unit_id,
    //   wet_or_dry: item.wet_or_dry,
    //   unit_price_cents: item.unit_price_cents,
    //   qty: item.qty || 1
    // });

    const { error: itemError } = await supabase.from('order_items').insert({
      order_id: order.id,
      unit_id: item.unit_id,
      wet_or_dry: item.wet_or_dry,
      unit_price_cents: item.unit_price_cents,
      qty: item.qty || 1,
    });

    if (itemError) {
      console.error('Order item insert error:', itemError);
      console.error('Failed cart item:', item);
      throw itemError;
    }
  }

  // 6. Task status records will be auto-created by trigger when order is confirmed
  // (Previously created route_stops here, but that table is now deprecated in favor of task_status)

  // 7. Create consent records
  const consentRecords = [];

  if (smsConsent) {
    consentRecords.push({
      order_id: order.id,
      customer_id: customer.id,
      consent_type: 'sms',
      consented: true,
      consent_text: 'I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.',
      consent_version: '1.0',
    });
  }

  if (cardOnFileConsent) {
    consentRecords.push({
      order_id: order.id,
      customer_id: customer.id,
      consent_type: 'card_on_file',
      consented: true,
      consent_text: 'I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt.',
      consent_version: '1.0',
    });
  }

  if (consentRecords.length > 0) {
    const { error: consentError } = await (supabase as any)
      .from('consent_records')
      .insert(consentRecords);

    if (consentError) {
      console.error('Error creating consent records:', consentError);
    }
  }

  return order.id;
}

export async function completeOrderAfterPayment(orderId: string, _paymentIntentId: string) {
  const { data: order } = await supabase
    .from('orders')
    .select(`
      *,
      customers (first_name, last_name, email),
      order_items (
        qty,
        units (name)
      )
    `)
    .eq('id', orderId)
    .single();

  if (!order || !order.customers) {
    throw new Error('Order or customer not found');
  }

  const { data: invoiceLink } = await supabase
    .from('invoice_links' as any)
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  const isAdminSent = !!invoiceLink;

  if (isAdminSent) {
    const { error: timestampError } = await supabase
      .from('orders')
      .update({ invoice_accepted_at: new Date().toISOString() })
      .eq('id', orderId);

    if (timestampError) throw timestampError;

    try {
      const { enterConfirmed } = await import('./orderLifecycle');
      await enterConfirmed(orderId, 'invoice_page_payment', 'charged_now');
    } catch (lifecycleError) {
      console.error('[orderCreation] enterConfirmed (admin invoice) failed (non-fatal):', lifecycleError);
    }
  } else {
    try {
      const { enterPendingReview } = await import('./orderLifecycle');
      await enterPendingReview(orderId, 'standard_checkout');
    } catch (lifecycleError) {
      console.error('[orderCreation] enterPendingReview failed (non-fatal):', lifecycleError);
    }
  }

  return order.id;
}
