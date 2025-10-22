import { supabase } from './supabase';
import { addDays, format } from 'date-fns';

const DEVON_CONTACT = {
  first_name: 'Devon',
  last_name: 'Hawkins',
  email: 'hawkinsd90@gmail.com',
  phone: '7343588854',
};

const REMOTE_ADDRESSES = [
  {
    formatted_address: '123 Main St, Ann Arbor, MI 48104',
    street_address: '123 Main St',
    city: 'Ann Arbor',
    state: 'MI',
    zip_code: '48104',
    latitude: 42.2808,
    longitude: -83.7430,
  },
  {
    formatted_address: '456 Oak Ave, Ypsilanti, MI 48197',
    street_address: '456 Oak Ave',
    city: 'Ypsilanti',
    state: 'MI',
    zip_code: '48197',
    latitude: 42.2411,
    longitude: -83.6130,
  },
  {
    formatted_address: '789 Elm Rd, Canton, MI 48188',
    street_address: '789 Elm Rd',
    city: 'Canton',
    state: 'MI',
    zip_code: '48188',
    latitude: 42.3087,
    longitude: -83.4819,
  },
];

async function findAvailableUnits(date: string, count: number = 2) {
  console.log(`🔍 [TEST BOOKING] Finding ${count} available units for date: ${date}`);

  const { data: units, error } = await supabase
    .from('units')
    .select('id, name, price_dry_cents, quantity_available')
    .eq('active', true)
    .limit(10);

  if (error) {
    console.error('❌ [TEST BOOKING] Error fetching units:', error);
    return [];
  }

  console.log(`📦 [TEST BOOKING] Found ${units?.length || 0} active units in database`);

  if (!units || units.length === 0) {
    console.warn('⚠️ [TEST BOOKING] No active units found');
    return [];
  }

  const availableUnits = [];
  for (const unit of units) {
    console.log(`🔍 [TEST BOOKING] Checking availability for unit: ${unit.name} (${unit.id})`);

    const { data: conflicts, error: conflictError } = await supabase
      .from('order_items')
      .select('order_id, orders!inner(id, start_date, end_date, status)')
      .eq('unit_id', unit.id)
      .not('orders.status', 'in', '(cancelled,void,draft)')
      .lte('orders.start_date', date)
      .gte('orders.end_date', date);

    if (conflictError) {
      console.error(`❌ [TEST BOOKING] Error checking conflicts for ${unit.name}:`, conflictError);
      continue;
    }

    const quantityBooked = conflicts?.length || 0;
    const quantityAvailable = unit.quantity_available || 1;

    console.log(`📊 [TEST BOOKING] Unit ${unit.name}: ${quantityBooked}/${quantityAvailable} booked on ${date}`);

    if (quantityBooked < quantityAvailable) {
      console.log(`✅ [TEST BOOKING] Unit ${unit.name} is available!`);
      availableUnits.push(unit);
      if (availableUnits.length >= count) {
        console.log(`🎉 [TEST BOOKING] Found ${count} available units!`);
        break;
      }
    }
  }

  console.log(`📊 [TEST BOOKING] Total available units found: ${availableUnits.length}`);
  return availableUnits;
}

async function findAvailableDate() {
  console.log('📅 [TEST BOOKING] Starting to find available date...');
  let currentDate = addDays(new Date(), 1);
  const maxAttempts = 90;

  for (let i = 0; i < maxAttempts; i++) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    console.log(`🔍 [TEST BOOKING] Attempt ${i + 1}/${maxAttempts}: Checking date ${dateStr}`);
    const units = await findAvailableUnits(dateStr, 2);

    if (units.length >= 2) {
      console.log(`✅ [TEST BOOKING] Found available date: ${dateStr} with ${units.length} units`);
      return { date: dateStr, units };
    } else {
      console.log(`⏭️ [TEST BOOKING] Date ${dateStr} only has ${units.length} units, trying next date...`);
    }

    currentDate = addDays(currentDate, 1);
  }

  console.error('❌ [TEST BOOKING] Could not find available date within 90 days');
  throw new Error('Could not find available date within 90 days');
}

export async function createTestBooking() {
  console.log('🚀 [TEST BOOKING] Starting test booking creation...');
  try {
    const existingCart = localStorage.getItem('bpc_cart');
    const existingQuote = localStorage.getItem('bpc_quote_form');

    if (existingCart && existingQuote) {
      console.log('ℹ️ [TEST BOOKING] Found existing cart and quote, reusing them');
      const contactData = {
        ...DEVON_CONTACT,
        location_type: 'residential',
        same_day_pickup: true,
        warnings_acknowledged: {
          sandbags: true,
          generator: true,
          sameday: true,
        },
      };

      localStorage.setItem('bpc_contact_data', JSON.stringify(contactData));
      localStorage.setItem('test_booking_tip', '1000');

      console.log('✅ [TEST BOOKING] Reused existing booking data');
      return { success: true, date: 'existing', units: [] };
    }

    console.log('🆕 [TEST BOOKING] Creating new test booking...');
    const randomAddress = REMOTE_ADDRESSES[Math.floor(Math.random() * REMOTE_ADDRESSES.length)];
    console.log('📍 [TEST BOOKING] Selected address:', randomAddress.formatted_address);

    console.log('🔍 [TEST BOOKING] Searching for available date and units...');
    const { date, units } = await findAvailableDate();
    const endDate = addDays(new Date(date), 1);

    const quoteData = {
      event_date: date,
      event_end_date: format(endDate, 'yyyy-MM-dd'),
      start_window: '09:00',
      end_window: '17:00',
      address_line1: randomAddress.street_address,
      address_line2: '',
      city: randomAddress.city,
      state: randomAddress.state,
      zip: randomAddress.zip_code,
      location_type: 'residential',
      pickup_preference: 'next_day',
      same_day_responsibility_accepted: false,
      overnight_responsibility_accepted: true,
      can_stake: true,
      has_generator: false,
      has_pets: false,
      special_details: 'Test booking',
    };

    const cart = units.map((unit) => ({
      unit_id: unit.id,
      unit_name: unit.name,
      wet_or_dry: 'dry',
      unit_price_cents: unit.price_dry_cents,
      qty: 1,
      is_combo: false,
    }));

    const subtotal = units.reduce((sum, u) => sum + u.price_dry_cents, 0);
    const travelFee = 5000;
    const tax = Math.round((subtotal + travelFee) * 0.06);
    const total = subtotal + travelFee + tax;
    const depositDue = cart.length * 5000;
    const balanceDue = total - depositDue;

    const priceBreakdown = {
      subtotal_cents: subtotal,
      travel_fee_cents: travelFee,
      tax_cents: tax,
      total_cents: total,
      deposit_due_cents: depositDue,
      balance_due_cents: balanceDue,
    };

    const contactData = {
      ...DEVON_CONTACT,
      location_type: 'residential',
      same_day_pickup: false,
      warnings_acknowledged: {
        sandbags: false,
        generator: false,
        sameday: false,
      },
    };

    console.log('💾 [TEST BOOKING] Saving test booking data to localStorage...');
    console.log('🛒 [TEST BOOKING] Cart:', cart);
    console.log('📝 [TEST BOOKING] Quote data:', quoteData);
    console.log('💰 [TEST BOOKING] Price breakdown:', priceBreakdown);

    localStorage.setItem('bpc_quote_form', JSON.stringify(quoteData));
    localStorage.setItem('bpc_cart', JSON.stringify(cart));
    localStorage.setItem('bpc_price_breakdown', JSON.stringify(priceBreakdown));
    localStorage.setItem('bpc_contact_data', JSON.stringify(contactData));
    localStorage.setItem('test_booking_tip', '1000');

    console.log('✅ [TEST BOOKING] Test booking data saved to localStorage successfully!');
    console.log('🎯 [TEST BOOKING] Returning success with date:', date, 'and units:', units.map(u => u.name));

    return { success: true, date, units };
  } catch (error) {
    console.error('❌ [TEST BOOKING] Failed to create test booking:', error);
    return { success: false, error };
  }
}
