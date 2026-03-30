import { supabase } from './supabase';

let sessionId: string | null = null;

function getSessionId(): string {
  if (sessionId) return sessionId;
  const stored = sessionStorage.getItem('bpc_session_id');
  if (stored) {
    sessionId = stored;
    return sessionId;
  }
  const newId = crypto.randomUUID();
  sessionStorage.setItem('bpc_session_id', newId);
  sessionId = newId;
  return sessionId;
}

async function isAdminOrMaster(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'master'])
      .maybeSingle();

    return data !== null;
  } catch {
    return false;
  }
}

export type SiteEventName =
  | 'page_view'
  | 'unit_view'
  | 'quote_started'
  | 'quote_submitted'
  | 'checkout_started'
  | 'checkout_completed'
  | 'customer_portal_viewed'
  | 'payment_link_opened'
  | 'waiver_link_opened'
  | 'cart_item_added'
  | 'cart_item_removed'
  | 'price_preview_shown'
  | 'quote_address_entered'
  | 'quote_date_selected'
  | 'quote_price_calculated';

interface TrackEventOptions {
  unitId?: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}

export async function trackEventOnce(
  eventName: SiteEventName,
  options: TrackEventOptions = {}
): Promise<void> {
  const key = `bpc_tracked_${eventName}_${window.location.pathname}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  await trackEvent(eventName, options);
}

export async function trackEvent(
  eventName: SiteEventName,
  options: TrackEventOptions = {}
): Promise<void> {
  try {
    const adminOrMaster = await isAdminOrMaster();
    if (adminOrMaster) return;

    const pagePath = window.location.pathname;
    await supabase.from('site_events').insert({
      event_name: eventName,
      session_id: getSessionId(),
      unit_id: options.unitId || null,
      order_id: options.orderId || null,
      page_path: pagePath,
      metadata: options.metadata || {},
    });
  } catch {
    // Tracking failures must never break the user experience
  }
}
