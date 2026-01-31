import { supabase } from './supabase';
import { formatCurrency } from './pricing';
import { checkMultipleUnitsAvailability } from './availability';
import { formatOrderId } from './utils';

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
  } = data;

  // 0. CRITICAL SAFETY CHECK: Verify availability before creating order
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
      name: `${contactData.first_name} ${contactData.last_name}`,
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

  // 3. Create address
  const eventAddressData = billingSameAsEvent
    ? billingAddress
    : {
        line1: quoteData.address_line1,
        line2: quoteData.address_line2 || null,
        city: quoteData.city,
        state: quoteData.state,
        zip: quoteData.zip,
      };

  const { data: address, error: addressError } = await supabase
    .from('addresses')
    .insert({
      customer_id: customer.id,
      ...eventAddressData,
    })
    .select()
    .single();

  if (addressError) throw addressError;

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
      tax_cents: priceBreakdown.tax_cents,
      tax_waived: false,
      tax_waive_reason: null,
      travel_fee_waived: false,
      travel_fee_waive_reason: null,
      same_day_pickup_fee_waived: false,
      same_day_pickup_fee_waive_reason: null,
      tip_cents: 0,
      total_cents: priceBreakdown.total_cents,
      deposit_due_cents: priceBreakdown.deposit_due_cents,
      deposit_paid_cents: 0,
      balance_due_cents: priceBreakdown.balance_due_cents,
      custom_deposit_cents: null,
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
    console.log('Creating order item:', {
      order_id: order.id,
      unit_id: item.unit_id,
      wet_or_dry: item.wet_or_dry,
      unit_price_cents: item.unit_price_cents,
      qty: item.qty || 1
    });

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

  // Note: invoice_links table doesn't exist in current schema
  // const { data: invoiceLink } = await supabase
  //   .from('invoice_links')
  //   .select('id')
  //   .eq('order_id', orderId)
  //   .maybeSingle();
  // const isAdminSent = !!invoiceLink;

  const newStatus = 'pending_review';

  const updateData: any = {
    status: newStatus,
    deposit_paid_cents: order.deposit_due_cents,
  };

  if (isAdminSent) {
    updateData.invoice_accepted_at = new Date().toISOString();
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', orderId);

  if (orderError) throw orderError;

  const customer = (order.customers as any);

  const contactData = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
  };

  const cart = ((order.order_items as any) ?? []).map((item: any) => ({
    unit_name: item.units.name,
    qty: item.qty,
  }));


  // Note: messages table doesn't exist in current schema
  // Create confirmation message would go here
  // await supabase.from('messages').insert({
  //   order_id: order.id,
  //   to_email: contactData.email,
  //   channel: 'email',
  //   template_key: 'deposit_receipt',
  //   payload_json: {
  //     name: `${contactData.first_name} ${contactData.last_name}`,
  //     units: cart.map((item: any) => item.unit_name).join(', '),
  //     event_date: order.event_date,
  //     balance: formatCurrency(order.balance_due_cents),
  //   },
  //   status: 'pending',
  // });

  try {
    const { sendAdminSms } = await import('./notificationService');

    const smsMessage = isAdminSent
      ? `✅ INVOICE PAID! ${contactData.first_name} ${contactData.last_name} for ${order.event_date}. Order CONFIRMED. #${formatOrderId(order.id)}`
      : `🎈 NEW BOOKING! ${contactData.first_name} ${contactData.last_name} for ${order.event_date}. Review in admin panel. Order #${formatOrderId(order.id)}`;

    await sendAdminSms(smsMessage, order.id);
  } catch (smsError) {
    console.error('Error sending SMS notification:', smsError);
  }

  return order.id;
}
