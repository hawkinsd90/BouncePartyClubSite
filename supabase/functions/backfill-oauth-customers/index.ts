import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (!user) {
      throw new Error('Not authenticated');
    }

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingCustomer) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Customer record already exists',
          customer_id: existingCustomer.id
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const userName = user.user_metadata?.full_name ||
                     user.user_metadata?.name ||
                     user.email?.split('@')[0] ||
                     'User';

    const nameParts = userName.split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';
    const phone = user.phone || user.user_metadata?.phone || '';
    const provider = user.app_metadata?.provider || 'email';

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        email: user.email!,
        phone: phone,
        oauth_provider: provider,
        oauth_profile_data: user.user_metadata || {},
      })
      .select()
      .single();

    if (customerError) {
      const { data: customerByEmail } = await supabase
        .from('customers')
        .select('id')
        .eq('email', user.email!)
        .maybeSingle();

      if (customerByEmail) {
        await supabase
          .from('customers')
          .update({
            user_id: user.id,
            oauth_provider: provider,
            oauth_profile_data: user.user_metadata || {},
          })
          .eq('id', customerByEmail.id);

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Linked existing customer to user',
            customer_id: customerByEmail.id
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      throw customerError;
    }

    const { error: contactError } = await supabase
      .from('contacts')
      .upsert({
        customer_id: customer.id,
        first_name: firstName,
        last_name: lastName,
        email: user.email!,
        phone: phone,
        source: 'oauth_backfill',
      }, {
        onConflict: 'email',
      });

    if (contactError) {
      console.error('Contact creation error:', contactError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Customer record created successfully',
        customer_id: customer.id,
        profile: {
          first_name: firstName,
          last_name: lastName,
          email: user.email,
          phone: phone,
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to backfill customer record'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
