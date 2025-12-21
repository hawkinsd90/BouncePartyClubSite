import { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface AdminSettingsCache {
  [key: string]: { value: string | null; timestamp: number };
}

const CACHE_DURATION_MS = 5 * 60 * 1000;
const cache: AdminSettingsCache = {};

export async function getAdminSetting(
  supabase: SupabaseClient,
  key: string,
  useCache = true
): Promise<string | null> {
  if (useCache && cache[key]) {
    const { value, timestamp } = cache[key];
    const now = Date.now();
    if (now - timestamp < CACHE_DURATION_MS) {
      return value;
    }
  }

  const { data, error } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", key)
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
  supabase: SupabaseClient,
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
      .from("admin_settings")
      .select("key, value")
      .in("key", keysToFetch);

    if (error) {
      console.error("Error fetching admin settings:", error);
      keysToFetch.forEach((key) => {
        results[key] = null;
      });
      return results;
    }

    const now = Date.now();
    keysToFetch.forEach((key) => {
      const setting = data?.find((s) => s.key === key);
      const value = setting?.value || null;
      results[key] = value;
      cache[key] = { value, timestamp: now };
    });
  }

  return results;
}

export const ADMIN_SETTING_KEYS = {
  STRIPE_SECRET_KEY: "stripe_secret_key",
  STRIPE_PUBLISHABLE_KEY: "stripe_publishable_key",
  ADMIN_NOTIFICATION_PHONE: "admin_notification_phone",
  ADMIN_EMAIL: "admin_email",
  TWILIO_ACCOUNT_SID: "twilio_account_sid",
  TWILIO_AUTH_TOKEN: "twilio_auth_token",
  TWILIO_PHONE_NUMBER: "twilio_phone_number",
} as const;
