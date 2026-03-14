import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { line1, line2, city, state, zip, lat, lng } = body;

    if (!line1 || !city || !state || !zip) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required address fields: line1, city, state, zip' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ success: false, error: 'Customer record not found for this user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: address, error: addressError } = await supabase
      .from('addresses')
      .insert({
        customer_id: customer.id,
        line1,
        line2: line2 || null,
        city,
        state,
        zip,
        lat: lat || null,
        lng: lng || null,
      })
      .select('id')
      .single();

    if (addressError || !address) {
      return new Response(
        JSON.stringify({ success: false, error: addressError?.message || 'Failed to save address' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await supabase
      .from('customers')
      .update({ default_address_id: address.id })
      .eq('id', customer.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Address saved but failed to set as default' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, address_id: address.id, customer_id: customer.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
