import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CreateAdminRequest {
  email: string;
  password: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { email, password, twilioAccountSid, twilioAuthToken, twilioFromNumber }: CreateAdminRequest = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Missing email or password" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: existingUsers } = await supabase.rpc('get_admin_users');
    
    if (existingUsers && existingUsers.length > 0) {
      return new Response(
        JSON.stringify({ error: "Admin user already exists" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'ADMIN'
      }
    });

    if (signUpError) {
      console.error('Sign up error:', signUpError);
      throw signUpError;
    }
    
    if (!authData.user) {
      throw new Error('Failed to create user');
    }

    await supabase.from('user_roles').insert({
      user_id: authData.user.id,
      role: 'ADMIN'
    });

    if (twilioAccountSid && twilioAuthToken && twilioFromNumber) {
      const updates = [
        { key: 'twilio_account_sid', value: twilioAccountSid },
        { key: 'twilio_auth_token', value: twilioAuthToken },
        { key: 'twilio_from_number', value: twilioFromNumber }
      ];

      for (const update of updates) {
        await supabase
          .from('admin_settings')
          .update({ value: update.value })
          .eq('key', update.key);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authData.user.id,
          email: authData.user.email
        }
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: unknown) {
    console.error("Error creating admin user:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create admin user";
    return new Response(
      JSON.stringify({
        error: errorMessage,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});