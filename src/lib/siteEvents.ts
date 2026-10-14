import { supabase } from './supabase';
import { redactCredentialsInPath } from './portal/portalToken';

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
  | 'cart_started'
  | 'cart_submitted'
  | 'checkout_started'
  | 'checkout_completed'
  | 'customer_portal_viewed'
  | 'payment_link_opened'
  | 'waiver_link_opened'
  | 'cart_item_added'
  | 'cart_item_removed'
  | 'cart_address_entered'
  | 'cart_date_selected'
  | 'cart_price_calculated';

interface TrackEventOptions {
  unitId?: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}

export async function trackEventOnce(
  eventName: SiteEventName,
  options: TrackEventOptions = {}
): Promise<void> {
  const key = `bpc_tracked_${eventName}_${redactCredentialsInPath(window.location.pathname)}`;
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

    const pagePath = redactCredentialsInPath(window.location.pathname);
    // Events go through the ingestion function: the table no longer accepts direct writes from the browser.
    await supabase.functions.invoke('record-site-event', {
      body: {
        event_name: eventName,
        session_id: getSessionId(),
        ...(options.unitId ? { unit_id: options.unitId } : {}),
        ...(options.orderId ? { order_id: options.orderId } : {}),
        page_path: pagePath,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
    });
  } catch {
    // Tracking failures must never break the user experience
  }
}
