import { supabase } from './supabase';
import { formatCurrency } from './pricing';

interface OrderData {
  contactData: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  billingAddress: any;
  billingSameAsEvent: boolean;
  smsConsent: boolean;
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
  } = data;

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
      })
      .select()
      .single();

    if (customerError) throw customerError;
    customer = newCustomer;
  }

  // 2. Create or update contact
  const { error: contactError } = await supabase.from('contacts').upsert(
    {
      customer_id: customer.id,
      first_name: contactData.first_name,
      last_name: contactData.last_name,
      email: contactData.email,
      phone: contactData.phone,
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

  // 4. Create order with 'draft' status (unpaid invoice) and deposit_required = true
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      status: 'draft',
      deposit_required: true,
      location_type: quoteData.location_type,
      surface: quoteData.can_stake ? 'grass' : 'cement',
      event_date: quoteData.event_date,
      start_date: quoteData.event_date,
      end_date: quoteData.event_end_date || quoteData.event_date,
      start_window: quoteData.start_window,
      end_window: quoteData.end_window,
      overnight_allowed: quoteData.pickup_preference === 'next_day',
      can_use_stakes: quoteData.can_stake,
      generator_selected: quoteData.has_generator,
      has_pets: quoteData.has_pets || false,
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
      tax_cents: priceBreakdown.tax_cents,
      deposit_due_cents: priceBreakdown.deposit_due_cents,
      deposit_paid_cents: 0,
      balance_due_cents: priceBreakdown.balance_due_cents,
      card_on_file_consent_text:
        'I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt.',
      card_on_file_consented_at: new Date().toISOString(),
      sms_consent_text:
        'I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.',
      sms_consented_at: new Date().toISOString(),
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

  // 6. Create route stops
  await supabase.from('route_stops').insert([
    {
      order_id: order.id,
      type: 'dropoff',
      checkpoint: 'none',
    },
    {
      order_id: order.id,
      type: 'pickup',
      checkpoint: 'none',
    },
  ]);

  return order.id;
}

export async function completeOrderAfterPayment(orderId: string, paymentIntentId: string) {
  // Get order details first to get deposit amount
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

  if (!order) throw new Error('Order not found');

  // Update order status and payment info
  const { error: orderError } = await supabase
    .from('orders')
    .update({
      status: 'pending',
      deposit_paid_cents: order.deposit_due_cents,
    })
    .eq('id', orderId);

  if (orderError) throw orderError;

  const contactData = {
    first_name: order.customers.first_name,
    last_name: order.customers.last_name,
    email: order.customers.email,
  };

  const cart = order.order_items.map((item: any) => ({
    unit_name: item.units.name,
    qty: item.qty,
  }));

  // Create confirmation message
  await supabase.from('messages').insert({
    order_id: order.id,
    to_email: contactData.email,
    channel: 'email',
    template_key: 'deposit_receipt',
    payload_json: {
      name: `${contactData.first_name} ${contactData.last_name}`,
      units: cart.map((item: any) => item.unit_name).join(', '),
      event_date: order.event_date,
      balance: formatCurrency(order.balance_due_cents),
    },
    status: 'pending',
  });

  // Send SMS notification to admin - COMMENTED OUT FOR TESTING
  // try {
  //   const { data: adminSettings } = await supabase
  //     .from('admin_settings')
  //     .select('value')
  //     .eq('key', 'admin_notification_phone')
  //     .maybeSingle();

  //   if (adminSettings?.value) {
  //     const smsMessage = `🎈 NEW BOOKING! ${contactData.first_name} ${contactData.last_name} for ${order.event_date}. Review in admin panel. Order #${order.id.slice(0, 8).toUpperCase()}`;

  //     const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
  //     await fetch(apiUrl, {
  //       method: 'POST',
  //       headers: {
  //         Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         to: adminSettings.value,
  //         message: smsMessage,
  //         orderId: order.id,
  //       }),
  //     });
  //   }
  // } catch (smsError) {
  //   console.error('Error sending SMS notification:', smsError);
  // }

  return order.id;
}

export async function createOrderAfterPayment(data: OrderData) {
  const {
    contactData,
    quoteData,
    priceBreakdown,
    cart,
    billingAddress,
    billingSameAsEvent,
    smsConsent,
  } = data;

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
      })
      .select()
      .single();

    if (customerError) throw customerError;
    customer = newCustomer;
  }

  // 2. Create contact IMMEDIATELY (before order)
  await supabase.from('contacts').upsert(
    {
      customer_id: contactData.email,
      first_name: contactData.first_name,
      last_name: contactData.last_name,
      email: contactData.email,
      phone: contactData.phone,
      source: 'booking',
      opt_in_email: true,
      opt_in_sms: smsConsent,
    },
    {
      onConflict: 'email',
    }
  );

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

  // 4. Create order with deposit_paid (payment already succeeded)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      status: 'pending_review',
      location_type: quoteData.location_type,
      surface: quoteData.can_stake ? 'grass' : 'cement',
      event_date: quoteData.event_date,
      start_date: quoteData.event_date,
      end_date: quoteData.event_end_date || quoteData.event_date,
      start_window: quoteData.start_window,
      end_window: quoteData.end_window,
      overnight_allowed: quoteData.pickup_preference === 'next_day',
      can_use_stakes: quoteData.can_stake,
      generator_selected: quoteData.has_generator,
      has_pets: quoteData.has_pets || false,
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
      tax_cents: priceBreakdown.tax_cents,
      deposit_due_cents: priceBreakdown.deposit_due_cents,
      deposit_paid_cents: priceBreakdown.deposit_due_cents, // Payment succeeded
      balance_due_cents: priceBreakdown.balance_due_cents,
      payment_method_id: 'stripe_pm_' + Date.now(),
      card_on_file_consent_text:
        'I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt.',
      card_on_file_consented_at: new Date().toISOString(),
      sms_consent_text:
        'I consent to receive transactional SMS messages from Bounce Party Club LLC regarding my booking, including order confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out.',
      sms_consented_at: new Date().toISOString(),
      special_details: quoteData.special_details || null,
    })
    .select()
    .single();

  if (orderError) throw orderError;

  // 5. Create order items
  for (const item of cart) {
    console.log('Creating order item (after payment):', {
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
      console.error('Order item insert error (after payment):', itemError);
      console.error('Failed cart item:', item);
      throw itemError;
    }
  }

  // 6. Create route stops
  await supabase.from('route_stops').insert([
    {
      order_id: order.id,
      type: 'dropoff',
      checkpoint: 'none',
    },
    {
      order_id: order.id,
      type: 'pickup',
      checkpoint: 'none',
    },
  ]);

  // 7. Create confirmation message
  await supabase.from('messages').insert({
    order_id: order.id,
    to_email: contactData.email,
    channel: 'email',
    template_key: 'deposit_receipt',
    payload_json: {
      name: `${contactData.first_name} ${contactData.last_name}`,
      units: cart.map((item) => item.unit_name).join(', '),
      event_date: quoteData.event_date,
      balance: formatCurrency(priceBreakdown.balance_due_cents),
    },
    status: 'pending',
  });

  // 8. Send SMS notification to admin - COMMENTED OUT FOR TESTING
  // try {
  //   const { data: adminSettings } = await supabase
  //     .from('admin_settings')
  //     .select('value')
  //     .eq('key', 'admin_notification_phone')
  //     .maybeSingle();

  //   if (adminSettings?.value) {
  //     const smsMessage = `🎈 NEW BOOKING! ${contactData.first_name} ${contactData.last_name} for ${quoteData.event_date}. Review in admin panel. Order #${order.id.slice(0, 8).toUpperCase()}`;

  //     const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
  //     await fetch(apiUrl, {
  //       method: 'POST',
  //       headers: {
  //         Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         to: adminSettings.value,
  //         message: smsMessage,
  //         orderId: order.id,
  //       }),
  //     });
  //   }
  // } catch (smsError) {
  //   console.error('Error sending SMS notification:', smsError);
  //   // Don't throw - SMS failure shouldn't fail the order
  // }

  return order.id;
}
