import { supabase } from './supabase';

interface AdminSettingsCache {
  [key: string]: { value: string | null; timestamp: number };
}

const CACHE_DURATION_MS = 5 * 60 * 1000;
const cache: AdminSettingsCache = {};

export async function getAdminSetting(key: string, useCache = true): Promise<string | null> {
  if (useCache && cache[key]) {
    const { value, timestamp } = cache[key];
    const now = Date.now();
    if (now - timestamp < CACHE_DURATION_MS) {
      return value;
    }
  }

  const { data, error } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    console.error(`Error fetching admin setting "${key}":`, error);
    return null;
  }

  const value = data?.value || null;

  cache[key] = {
    value,
    timestamp: Date.now(),
  };

  return value;
}

export async function getMultipleAdminSettings(
  keys: string[],
  useCache = true
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  const keysToFetch: string[] = [];

  for (const key of keys) {
    if (useCache && cache[key]) {
      const { value, timestamp } = cache[key];
      const now = Date.now();
      if (now - timestamp < CACHE_DURATION_MS) {
        results[key] = value;
        continue;
      }
    }
    keysToFetch.push(key);
  }

  if (keysToFetch.length > 0) {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('key, value')
      .in('key', keysToFetch);

    if (error) {
      console.error('Error fetching admin settings:', error);
      keysToFetch.forEach(key => {
        results[key] = null;
      });
      return results;
    }

    const now = Date.now();
    keysToFetch.forEach(key => {
      const setting = data?.find(s => s.key === key);
      const value = setting?.value || null;
      results[key] = value;
      cache[key] = { value, timestamp: now };
    });
  }

  return results;
}

export function clearAdminSettingsCache(key?: string) {
  if (key) {
    delete cache[key];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
  }
}

export const ADMIN_SETTING_KEYS = {
  STRIPE_SECRET_KEY: 'stripe_secret_key',
  STRIPE_PUBLISHABLE_KEY: 'stripe_publishable_key',
  ADMIN_NOTIFICATION_PHONE: 'admin_notification_phone',
  ADMIN_EMAIL: 'admin_email',
  TWILIO_ACCOUNT_SID: 'twilio_account_sid',
  TWILIO_AUTH_TOKEN: 'twilio_auth_token',
  TWILIO_PHONE_NUMBER: 'twilio_phone_number',
  HOME_BASE_ADDRESS: 'home_base_address',
  HOME_BASE_LAT: 'home_base_lat',
  HOME_BASE_LNG: 'home_base_lng',
  TAX_RATE: 'tax_rate',
  GENERATOR_BASE_PRICE: 'generator_base_price_cents',
  GENERATOR_MULTI_DAY_FEE: 'generator_multi_day_fee_cents',
} as const;

export type AdminSettingKey = typeof ADMIN_SETTING_KEYS[keyof typeof ADMIN_SETTING_KEYS];

/**
 * Get the home base address from admin settings
 * Falls back to default Wayne, MI address if not found
 */
export async function getHomeBaseAddress(): Promise<{
  address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  zip: string;
}> {
  const settings = await getMultipleAdminSettings([
    'home_address_line1',
    'home_address_line2',
    'home_address_city',
    'home_address_state',
    'home_address_zip',
    'home_address_lat',
    'home_address_lng',
  ]);

  // Default to Wayne, MI if settings not found
  const defaultAddress = {
    address: '4426 Woodward St, Wayne, MI 48184',
    lat: 42.2808,
    lng: -83.3863,
    city: 'Wayne',
    state: 'MI',
    zip: '48184',
  };

  const line1 = settings['home_address_line1'];
  const line2 = settings['home_address_line2'];
  const city = settings['home_address_city'] || defaultAddress.city;
  const state = settings['home_address_state'] || defaultAddress.state;
  const zip = settings['home_address_zip'] || defaultAddress.zip;
  const lat = parseFloat(settings['home_address_lat'] || String(defaultAddress.lat));
  const lng = parseFloat(settings['home_address_lng'] || String(defaultAddress.lng));

  // Build address string
  let address = line1 || defaultAddress.address;
  if (line1) {
    if (line2) address += `, ${line2}`;
    address += `, ${city}, ${state} ${zip}`;
  }

  return {
    address,
    lat: isNaN(lat) ? defaultAddress.lat : lat,
    lng: isNaN(lng) ? defaultAddress.lng : lng,
    city,
    state,
    zip,
  };
}
