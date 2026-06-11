import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify the caller is an admin
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleData || !["admin", "master"].includes(roleData.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      id,
      base_radius_miles,
      per_mile_after_base_cents,
      surface_sandbag_fee_cents,
      deposit_per_unit_cents,
      included_cities,
      generator_fee_single_cents,
      generator_fee_multiple_cents,
      same_day_pickup_fee_cents,
      same_day_weekday_delivery_fee_cents,
      apply_taxes_by_default,
    } = body;

    // Use pg directly to bypass PostgREST schema cache
    const { Client } = await import("https://deno.land/x/postgres@v0.17.0/mod.ts");
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      throw new Error("SUPABASE_DB_URL not configured");
    }

    const client = new Client(dbUrl);
    await client.connect();

    try {
      await client.queryObject(
        `UPDATE pricing_rules SET
          base_radius_miles = $1,
          per_mile_after_base_cents = $2,
          surface_sandbag_fee_cents = $3,
          deposit_per_unit_cents = $4,
          included_cities = $5,
          generator_fee_single_cents = $6,
          generator_fee_multiple_cents = $7,
          same_day_pickup_fee_cents = $8,
          same_day_weekday_delivery_fee_cents = $9,
          apply_taxes_by_default = $10
        WHERE id = $11`,
        [
          base_radius_miles,
          per_mile_after_base_cents,
          surface_sandbag_fee_cents,
          deposit_per_unit_cents ?? 5000,
          included_cities ?? [],
          generator_fee_single_cents ?? 10000,
          generator_fee_multiple_cents ?? 7500,
          same_day_pickup_fee_cents ?? 0,
          same_day_weekday_delivery_fee_cents ?? 0,
          apply_taxes_by_default ?? true,
          id,
        ]
      );
    } finally {
      await client.end();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("update-pricing-rules error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
