import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const FRESH_USER_MAX_AGE_MS = 120_000;

interface ConsentEntry {
  type: string;
  version: string;
  consented: boolean;
}

interface SavePendingConsentBody {
  user_id: string;
  batch_id: string;
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

function isValidUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

    const body: SavePendingConsentBody = await req.json();
    const { user_id, batch_id, consents, source = 'signup', user_agent_hint } = body;

    if (!isValidUuid(user_id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidUuid(batch_id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid batch_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validationError = validateConsents(consents);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: fetchError } = await serviceClient.auth.admin.getUserById(user_id);

    if (fetchError || !user) {
      console.log('[save-pending-consent] user not found', { user_id, error: fetchError?.message });
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ageMs = Date.now() - new Date(user.created_at).getTime();
    if (ageMs > FRESH_USER_MAX_AGE_MS) {
      console.log('[save-pending-consent] rejected: user is not freshly created', { user_id, ageMs });
      return new Response(
        JSON.stringify({ success: false, error: 'User is not a freshly created account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const existing = user.user_metadata?.pending_consent;
    if (existing?.batch_id && existing.batch_id === batch_id) {
      console.log('[save-pending-consent] pending_consent already present with same batch_id — skipping write', { user_id, batch_id });
      return new Response(
        JSON.stringify({ success: true, written: false, already_present: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(user_id, {
      user_metadata: {
        ...user.user_metadata,
        pending_consent: {
          batch_id,
          consents,
          source,
          user_agent_hint: user_agent_hint ?? null,
        },
      },
    });

    if (updateError) {
      console.log('[save-pending-consent] metadata write failed', { user_id, error: updateError.message });
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[save-pending-consent] pending_consent written', { user_id, batch_id });
    return new Response(
      JSON.stringify({ success: true, written: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
