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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (action === 'drain-pending') {
      const pending = user.user_metadata?.pending_consent;

      if (!pending) {
        return new Response(
          JSON.stringify({ success: true, recorded: 0, skipped: 'no_pending_consent' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { consents, source, user_agent_hint } = pending as {
        consents: ConsentEntry[];
        source?: string;
        user_agent_hint?: string;
      };

      const validationError = validateConsents(consents);
      if (validationError) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid pending consent data: ${validationError}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: customer } = await serviceClient
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      const rows = consents.map((c: ConsentEntry) => ({
        user_id: user.id,
        customer_id: customer?.id ?? null,
        consent_type: c.type,
        consented: c.consented,
        policy_version: c.version,
        source: source ?? 'signup',
        user_agent_hint: user_agent_hint ?? null,
      }));

      const { error: insertError } = await serviceClient
        .from('user_consent_log')
        .insert(rows);

      if (insertError) {
        return new Response(
          JSON.stringify({ success: false, error: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await serviceClient.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, pending_consent: null },
      });

      return new Response(
        JSON.stringify({ success: true, recorded: rows.length, customer_id: customer?.id ?? null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RecordConsentBody = await req.json();
    const { consents, source = 'signup', user_agent_hint } = body;

    const validationError = validateConsents(consents);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: customer } = await serviceClient
      .from('customers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    const rows = consents.map(c => ({
      user_id: user.id,
      customer_id: customer?.id ?? null,
      consent_type: c.type,
      consented: c.consented,
      policy_version: c.version,
      source,
      user_agent_hint: user_agent_hint ?? null,
    }));

    const { error: insertError } = await serviceClient
      .from('user_consent_log')
      .insert(rows);

    if (insertError) {
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, recorded: rows.length, customer_id: customer?.id ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
