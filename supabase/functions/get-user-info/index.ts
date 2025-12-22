import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    const roleLower = userRole?.role?.toLowerCase();
    if (!roleLower || (roleLower !== 'master' && roleLower !== 'admin')) {
      throw new Error('Not authorized');
    }

    const { user_ids } = await req.json();

    if (!Array.isArray(user_ids)) {
      throw new Error('user_ids must be an array');
    }

    const userInfo: Record<string, { email: string; full_name: string }> = {};

    for (const userId of user_ids) {
      try {
        const { data: userData } = await supabase.auth.admin.getUserById(userId);
        if (userData?.user) {
          userInfo[userId] = {
            email: userData.user.email || 'Unknown',
            full_name: userData.user.user_metadata?.full_name || 
                      userData.user.email ||
                      'Unknown User',
          };
        } else {
          userInfo[userId] = {
            email: 'Unknown',
            full_name: 'Unknown User',
          };
        }
      } catch {
        userInfo[userId] = {
          email: 'Unknown',
          full_name: 'Unknown User',
        };
      }
    }

    return new Response(JSON.stringify({ userInfo }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});