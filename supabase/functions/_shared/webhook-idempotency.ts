import { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

// Stale processing timeout: 5 minutes
const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

interface WebhookProcessingResult {
  shouldProcess: boolean;
  alreadyProcessed: boolean;
  alreadyProcessing: boolean;
}

/**
 * Begins webhook processing with safe idempotency and retry logic
 *
 * Behavior:
 * - If status = 'succeeded' → skip (already done)
 * - If status = 'processing' and recent (<5 min) → skip (in progress)
 * - If status = 'processing' and stale OR 'failed' → allow retry
 * - If new → insert as 'processing' and allow
 *
 * Returns { shouldProcess, alreadyProcessed, alreadyProcessing }
 */
export async function beginWebhookProcessing(
  supabaseClient: SupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload?: any
): Promise<WebhookProcessingResult> {
  try {
    // Check for existing event
    const { data: existing, error: selectError } = await supabaseClient
      .from('stripe_webhook_events')
      .select('id, status, updated_at, attempts')
      .eq('stripe_event_id', stripeEventId)
      .maybeSingle();

    if (selectError) {
      console.error('[WebhookIdempotency] Error checking webhook:', selectError);
      // On error, allow processing to prevent blocking
      return { shouldProcess: true, alreadyProcessed: false, alreadyProcessing: false };
    }

    // Case 1: Event already succeeded
    if (existing && existing.status === 'succeeded') {
      // console.log(`[WebhookIdempotency] Event already succeeded: ${stripeEventId}`);
      return { shouldProcess: false, alreadyProcessed: true, alreadyProcessing: false };
    }

    // Case 2: Event is currently processing
    if (existing && existing.status === 'processing') {
      const updatedAt = new Date(existing.updated_at).getTime();
      const now = Date.now();
      const age = now - updatedAt;

      // If processing started recently, don't retry yet
      if (age < STALE_PROCESSING_TIMEOUT_MS) {
        // console.log(`[WebhookIdempotency] Event currently processing (age: ${Math.round(age / 1000)}s): ${stripeEventId}`);
        return { shouldProcess: false, alreadyProcessed: false, alreadyProcessing: true };
      }

      // Processing is stale - allow retry
      // console.log(`[WebhookIdempotency] Stale processing detected (age: ${Math.round(age / 1000)}s), allowing retry: ${stripeEventId}`);

      // Update to processing with incremented attempts
      const { error: updateError } = await supabaseClient
        .from('stripe_webhook_events')
        .update({
          status: 'processing',
          attempts: existing.attempts + 1,
          last_error: null,
        })
        .eq('stripe_event_id', stripeEventId);

      if (updateError) {
        console.error('[WebhookIdempotency] Error updating stale event:', updateError);
        return { shouldProcess: false, alreadyProcessed: false, alreadyProcessing: false };
      }

      return { shouldProcess: true, alreadyProcessed: false, alreadyProcessing: false };
    }

    // Case 3: Event failed previously - allow retry
    if (existing && existing.status === 'failed') {
      // console.log(`[WebhookIdempotency] Failed event, allowing retry: ${stripeEventId}`);

      const { error: updateError } = await supabaseClient
        .from('stripe_webhook_events')
        .update({
          status: 'processing',
          attempts: existing.attempts + 1,
          last_error: null,
        })
        .eq('stripe_event_id', stripeEventId);

      if (updateError) {
        console.error('[WebhookIdempotency] Error updating failed event:', updateError);
        return { shouldProcess: false, alreadyProcessed: false, alreadyProcessing: false };
      }

      return { shouldProcess: true, alreadyProcessed: false, alreadyProcessing: false };
    }

    // Case 4: New event - insert as processing
    const { error: insertError } = await supabaseClient
      .from('stripe_webhook_events')
      .insert({
        stripe_event_id: stripeEventId,
        event_type: eventType,
        status: 'processing',
        attempts: 1,
        payload: payload || null,
        processed_at: new Date().toISOString(),
      });

    if (insertError) {
      // Check if it's a duplicate key error (race condition)
      if (insertError.code === '23505') {
        // console.log(`[WebhookIdempotency] Race condition detected, re-checking: ${stripeEventId}`);
        // Recursive call to re-check (will hit one of the cases above)
        return await beginWebhookProcessing(supabaseClient, stripeEventId, eventType, payload);
      }

      console.error('[WebhookIdempotency] Error inserting new event:', insertError);
      return { shouldProcess: false, alreadyProcessed: false, alreadyProcessing: false };
    }

    // console.log(`[WebhookIdempotency] New event, beginning processing: ${stripeEventId}`);
    return { shouldProcess: true, alreadyProcessed: false, alreadyProcessing: false };

  } catch (err) {
    console.error('[WebhookIdempotency] Exception in beginWebhookProcessing:', err);
    // On exception, allow processing to prevent blocking
    return { shouldProcess: true, alreadyProcessed: false, alreadyProcessing: false };
  }
}

/**
 * Marks webhook processing as successful
 */
export async function finalizeWebhookSuccess(
  supabaseClient: SupabaseClient,
  stripeEventId: string
): Promise<void> {
  try {
    const { error } = await supabaseClient
      .from('stripe_webhook_events')
      .update({
        status: 'succeeded',
        last_error: null,
      })
      .eq('stripe_event_id', stripeEventId);

    if (error) {
      console.error('[WebhookIdempotency] Error finalizing success:', error);
    } else {
      // console.log(`[WebhookIdempotency] Event succeeded: ${stripeEventId}`);
    }
  } catch (err) {
    console.error('[WebhookIdempotency] Exception finalizing success:', err);
  }
}

/**
 * Marks webhook processing as failed with error message
 */
export async function finalizeWebhookFailure(
  supabaseClient: SupabaseClient,
  stripeEventId: string,
  errorMessage: string
): Promise<void> {
  try {
    const { error } = await supabaseClient
      .from('stripe_webhook_events')
      .update({
        status: 'failed',
        last_error: errorMessage.substring(0, 1000), // Limit error message length
      })
      .eq('stripe_event_id', stripeEventId);

    if (error) {
      console.error('[WebhookIdempotency] Error finalizing failure:', error);
    } else {
      // console.log(`[WebhookIdempotency] Event failed: ${stripeEventId} - ${errorMessage}`);
    }
  } catch (err) {
    console.error('[WebhookIdempotency] Exception finalizing failure:', err);
  }
}

/**
 * DEPRECATED: Legacy function for backwards compatibility
 * Use beginWebhookProcessing() instead
 */
export async function checkWebhookIdempotency(
  supabaseClient: SupabaseClient,
  stripeEventId: string,
  eventType: string
): Promise<{ shouldProcess: boolean; alreadyProcessed: boolean }> {
  const result = await beginWebhookProcessing(supabaseClient, stripeEventId, eventType);
  return {
    shouldProcess: result.shouldProcess,
    alreadyProcessed: result.alreadyProcessed,
  };
}
