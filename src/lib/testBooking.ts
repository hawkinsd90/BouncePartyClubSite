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
  const { data: units } = await supabase
    .from('units')
    .select('id, name, price_dry_cents, quantity_available')
    .eq('active', true)
    .limit(10);

  if (!units || units.length === 0) return [];

  const availableUnits = [];
  for (const unit of units) {
    const { data: conflicts } = await supabase
      .from('order_items')
      .select('order_id, orders!inner(id, start_date, end_date, status)')
      .eq('unit_id', unit.id)
      .not('orders.status', 'in', '(cancelled,void,draft)');

    const quantityBooked = conflicts?.length || 0;
    const quantityAvailable = unit.quantity_available || 1;

    if (quantityBooked < quantityAvailable) {
      availableUnits.push(unit);
      if (availableUnits.length >= count) break;
    }
  }

  return availableUnits;
}

async function findAvailableDate() {
  let currentDate = addDays(new Date(), 1);
  const maxAttempts = 90;

  for (let i = 0; i < maxAttempts; i++) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const units = await findAvailableUnits(dateStr, 2);

    if (units.length >= 2) {
      return { date: dateStr, units };
    }

    currentDate = addDays(currentDate, 1);
  }

  throw new Error('Could not find available date within 90 days');
}

export async function createTestBooking() {
  try {
    const existingCart = localStorage.getItem('bpc_cart');
    const existingQuote = localStorage.getItem('bpc_quote_form');

    if (existingCart && existingQuote) {
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

      return { success: true, date: 'existing', units: [] };
    }

    const randomAddress = REMOTE_ADDRESSES[Math.floor(Math.random() * REMOTE_ADDRESSES.length)];

    const { date, units } = await findAvailableDate();

    const quoteData = {
      event_date: date,
      setup_time: '09:00',
      event_duration_hours: 4,
      address: randomAddress,
      location_type: 'residential',
      sandbags_needed: true,
      needs_generator: true,
      same_day_pickup: true,
    };

    const cart = units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      quantity: 1,
      base_price_cents: unit.price_dry_cents,
    }));

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

    localStorage.setItem('bpc_quote_form', JSON.stringify(quoteData));
    localStorage.setItem('bpc_cart', JSON.stringify(cart));
    localStorage.setItem('bpc_contact_data', JSON.stringify(contactData));
    localStorage.setItem('test_booking_tip', '1000');

    return { success: true, date, units };
  } catch (error) {
    console.error('Failed to create test booking:', error);
    return { success: false, error };
  }
}
