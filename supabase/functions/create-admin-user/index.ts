import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveCaller, requireRoles, authFailureResponse } from "../_shared/auth.ts";

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

// Creating an admin account grants a privileged role. Only the backend (service role) or a signed-in MASTER may do
// it: the user_roles policies let only master grant admin/master roles (admin may grant crew only), so this endpoint
// must not be a way around that. The public anon key, customers, crew and admins are all refused. There is no
// unauthenticated first-admin bootstrap any more; the business already has live master/admin accounts.
const ADMIN_CREATOR_ROLES = ["master"] as const;

// Canonical stored role value (the rest of the system reads lowercase roles).
const ADMIN_ROLE = "admin";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Authorization first, before the body is even parsed.
    const caller = await resolveCaller(supabase, req.headers.get("Authorization"), supabaseServiceKey);
    if (caller.kind !== "service") {
      const gate = requireRoles(caller, ADMIN_CREATOR_ROLES, {
        unauthorized: "Unauthorized",
        forbidden: "Forbidden: master access required.",
      });
      if (!gate.ok) {
        console.warn(
          `[create-admin-user] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} reason=master_required`
        );
        return authFailureResponse(gate, corsHeaders, "error-only");
      }
    }

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

    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: ADMIN_ROLE
      }
    });

    if (signUpError) {
      console.error('Sign up error:', signUpError);
      throw signUpError;
    }

    if (!authData.user) {
      throw new Error('Failed to create user');
    }

    const { error: roleError } = await supabase.from('user_roles').insert({
      user_id: authData.user.id,
      role: ADMIN_ROLE
    });

    if (roleError) {
      // Do not leave a login without a role behind.
      console.error('Role assignment error:', roleError);
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new Error('Failed to assign the admin role');
    }

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
