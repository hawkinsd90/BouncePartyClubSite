import { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * Checks if a webhook event has already been processed
 * Returns true if already processed, false if new
 */
export async function isWebhookProcessed(
  supabaseClient: SupabaseClient,
  stripeEventId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabaseClient
      .from('stripe_webhook_events')
      .select('id')
      .eq('stripe_event_id', stripeEventId)
      .maybeSingle();

    if (error) {
      console.error('[WebhookIdempotency] Error checking webhook:', error);
      return false; // Allow processing on error to prevent blocking
    }

    return !!data; // True if record exists
  } catch (err) {
    console.error('[WebhookIdempotency] Exception checking webhook:', err);
    return false;
  }
}

/**
 * Marks a webhook event as processed
 * Stores event details for audit trail
 */
export async function markWebhookProcessed(
  supabaseClient: SupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload?: any
): Promise<boolean> {
  try {
    const { error } = await supabaseClient
      .from('stripe_webhook_events')
      .insert({
        stripe_event_id: stripeEventId,
        event_type: eventType,
        payload: payload || null,
        processed_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[WebhookIdempotency] Error marking webhook processed:', error);
      return false;
    }

    console.log('[WebhookIdempotency] Webhook marked as processed:', stripeEventId);
    return true;
  } catch (err) {
    console.error('[WebhookIdempotency] Exception marking webhook:', err);
    return false;
  }
}

/**
 * Wrapper function to process webhook with idempotency check
 * Returns { shouldProcess, alreadyProcessed }
 */
export async function checkWebhookIdempotency(
  supabaseClient: SupabaseClient,
  stripeEventId: string,
  eventType: string
): Promise<{ shouldProcess: boolean; alreadyProcessed: boolean }> {
  const alreadyProcessed = await isWebhookProcessed(supabaseClient, stripeEventId);

  if (alreadyProcessed) {
    console.log(`[WebhookIdempotency] Skipping already processed event: ${stripeEventId}`);
    return { shouldProcess: false, alreadyProcessed: true };
  }

  // Mark as processed BEFORE processing to prevent race conditions
  const marked = await markWebhookProcessed(supabaseClient, stripeEventId, eventType);

  return { shouldProcess: marked, alreadyProcessed: false };
}
