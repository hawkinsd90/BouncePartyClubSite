import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ConsentEntry {
  type: string;
  version: string;
  consented: boolean;
}

interface RecordConsentBody {
  batch_id?: string;
  consents: ConsentEntry[];
  source?: string;
  user_agent_hint?: string;
}

const ALLOWED_CONSENT_TYPES = new Set([
  'terms_of_service',
  'privacy_policy',
  'marketing_email',
  'marketing_sms',
]);

function validateConsents(consents: ConsentEntry[]): string | null {
  if (!Array.isArray(consents) || consents.length === 0) {
    return 'consents must be a non-empty array';
  }
  for (const c of consents) {
    if (!ALLOWED_CONSENT_TYPES.has(c.type)) return `Invalid consent_type: ${c.type}`;
    if (typeof c.consented !== 'boolean') return `consented must be boolean for type: ${c.type}`;
    if (!c.version || typeof c.version !== 'string') return `version is required for type: ${c.type}`;
  }
  return null;
}

function isValidUuidFormat(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

interface InsertResult {
  inserted: number;
  skipped: number;
}

async function upsertConsentRows(
  serviceClient: ReturnType<typeof createClient>,
  rows: Record<string, unknown>[],
  hasBatchId: boolean
): Promise<{ result: InsertResult; error: string | null }> {
  if (!hasBatchId) {
    const { error } = await serviceClient.from('user_consent_log').insert(rows);
    if (error) return { result: { inserted: 0, skipped: 0 }, error: error.message };
    return { result: { inserted: rows.length, skipped: 0 }, error: null };
  }

  let inserted = 0;
  let skipped = 0;

  // The unique index uq_user_consent_log_batch_type (user_id, consent_batch_id, consent_type)
  // makes consent writes idempotent when a batch_id is present. If the drain function is called
  // more than once for the same signup event (two tabs, retry, token refresh), the second
  // pass produces constraint violations that are caught here and counted as skipped rather
  // than treated as errors — duplicate drain calls are expected and safe.
  for (const row of rows) {
    const { error } = await serviceClient
      .from('user_consent_log')
      .insert(row)
      .select();

    if (!error) {
      inserted++;
    } else if (
      error.code === '23505' ||
      error.message?.includes('duplicate') ||
      error.message?.includes('unique')
    ) {
      skipped++;
    } else {
      return { result: { inserted, skipped }, error: error.message };
    }
  }

  return { result: { inserted, skipped }, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // All actions require a valid auth token.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'drain-pending') {
      const pending = user.user_metadata?.pending_consent;

      if (!pending) {
        return new Response(
          JSON.stringify({ success: true, inserted: 0, skipped: 0, already_drained: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { batch_id, stamped_at, consents, source, user_agent_hint } = pending as {
        batch_id?: string;
        stamped_at?: string;
        consents: ConsentEntry[];
        source?: string;
        user_agent_hint?: string;
      };

      // Staleness guard: pending_consent written by a duplicate-signup against an existing
      // account will have a stamped_at that is substantially newer than user.created_at.
      // Legitimate pending_consent is stamped at account-creation time, so the gap is < a
      // few seconds. We reject anything stamped more than 120 s after account creation.
      // This prevents a duplicate-signup from inserting consent rows into the real account
      // when it later signs in — without requiring any unauthenticated revoke endpoint.
      if (stamped_at) {
        const accountCreatedMs = new Date(user.created_at).getTime();
        const stampedMs = new Date(stamped_at).getTime();
        const lagSeconds = (stampedMs - accountCreatedMs) / 1000;
        if (lagSeconds > 120) {
          console.warn('[record-consent] drain-pending: pending_consent stamped_at is', lagSeconds.toFixed(0), 's after account creation — rejecting as duplicate-signup artifact', { user_id: user.id, lagSeconds });
          return new Response(
            JSON.stringify({ success: true, inserted: 0, skipped: 0, rejected: true, reason: 'stale_pending_consent' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const validationError = validateConsents(consents);
      if (validationError) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid pending consent data: ${validationError}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const hasBatchId = isValidUuidFormat(batch_id);

      const { data: customer } = await serviceClient
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      const rows = consents.map((c: ConsentEntry) => ({
        user_id: user.id,
        customer_id: customer?.id ?? null,
        consent_batch_id: hasBatchId ? batch_id : null,
        consent_type: c.type,
        consented: c.consented,
        policy_version: c.version,
        source: source ?? 'signup',
        user_agent_hint: user_agent_hint ?? null,
      }));

      const { result, error: insertError } = await upsertConsentRows(serviceClient, rows, hasBatchId);

      if (insertError) {
        return new Response(
          JSON.stringify({ success: false, error: insertError, safe_to_clear_pending: false }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: clearError } = await serviceClient.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, pending_consent: null },
      });

      const pendingConsentCleared = !clearError;
      if (clearError) {
        console.log('[record-consent] drain-pending: metadata clear failed', { user_id: user.id, error: clearError.message });
      }

      return new Response(
        JSON.stringify({
          success: true,
          inserted: result.inserted,
          skipped: result.skipped,
          safe_to_clear_pending: true,
          pending_consent_cleared: pendingConsentCleared,
          customer_id: customer?.id ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RecordConsentBody = await req.json();
    const { batch_id, consents, source = 'signup', user_agent_hint } = body;

    const validationError = validateConsents(consents);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasBatchId = isValidUuidFormat(batch_id);

    const { data: customer } = await serviceClient
      .from('customers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    const rows = consents.map(c => ({
      user_id: user.id,
      customer_id: customer?.id ?? null,
      consent_batch_id: hasBatchId ? batch_id : null,
      consent_type: c.type,
      consented: c.consented,
      policy_version: c.version,
      source,
      user_agent_hint: user_agent_hint ?? null,
    }));

    const { result, error: insertError } = await upsertConsentRows(serviceClient, rows, hasBatchId);

    if (insertError) {
      return new Response(
        JSON.stringify({ success: false, error: insertError, safe_to_clear_pending: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: result.inserted,
        skipped: result.skipped,
        safe_to_clear_pending: true,
        customer_id: customer?.id ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
