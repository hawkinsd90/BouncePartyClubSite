import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!callerToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing bearer token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(callerToken);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = roleRow?.role?.toLowerCase() ?? "";
    if (!["master", "admin", "crew"].includes(role)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin or crew role required." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { date, userId } = body;

    if (!date) {
      return new Response(
        JSON.stringify({ error: "Missing required field: date (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetUserId = userId || user.id;

    // Fetch start mileage for validation
    const { data: mileageLog } = await supabaseAdmin
      .from("daily_mileage_logs")
      .select("start_mileage")
      .eq("date", date)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!mileageLog?.start_mileage) {
      return new Response(
        JSON.stringify({ error: "Start of day mileage must be recorded before auto-calculating end mileage." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all task_status rows for this date with their order addresses,
    // sorted by sort_order so we respect the saved route order
    const { data: taskRows, error: taskError } = await supabaseAdmin
      .from("task_status")
      .select(`
        sort_order,
        status,
        orders (
          addresses ( line1, city, state, zip )
        )
      `)
      .eq("task_date", date)
      .order("sort_order", { ascending: true });

    if (taskError) {
      console.error("task_status fetch error:", taskError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch tasks: " + taskError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract addresses that are valid (completed or active tasks)
    const taskAddresses: string[] = [];
    for (const row of (taskRows ?? [])) {
      const addr = (row.orders as any)?.addresses;
      if (addr?.line1 && addr?.city && addr?.state) {
        const full = `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip || ""}`.trim();
        taskAddresses.push(full);
      }
    }

    if (taskAddresses.length === 0) {
      return new Response(
        JSON.stringify({ error: "No task addresses found for this date. Make sure tasks are assigned and have delivery addresses." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch home base address from admin_settings
    const { data: homeBaseSetting } = await supabaseAdmin
      .from("admin_settings")
      .select("value")
      .eq("key", "home_base_address")
      .maybeSingle();

    const homeBase: string = homeBaseSetting?.value || "Wayne, MI 48184";

    // Build full route: home → stops in order → home
    const allAddresses = [homeBase, ...taskAddresses, homeBase];

    // Call Google Maps Distance Matrix API from the backend
    const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
    if (!googleMapsKey) {
      return new Response(
        JSON.stringify({ error: "Google Maps API key not configured on the server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalMeters = 0;
    const segmentResults: Array<{ from: string; to: string; distanceMiles: number }> = [];

    for (let i = 0; i < allAddresses.length - 1; i++) {
      const origin = encodeURIComponent(allAddresses[i]);
      const destination = encodeURIComponent(allAddresses[i + 1]);

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&units=imperial&key=${googleMapsKey}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        return new Response(
          JSON.stringify({ error: `Google Maps API request failed for segment ${i + 1}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await resp.json();
      const element = data?.rows?.[0]?.elements?.[0];

      if (!element || element.status !== "OK") {
        return new Response(
          JSON.stringify({
            error: `Could not calculate distance for segment ${i + 1}: ${allAddresses[i]} → ${allAddresses[i + 1]}. Status: ${element?.status ?? "unknown"}`,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const meters = element.distance.value;
      totalMeters += meters;
      segmentResults.push({
        from: allAddresses[i],
        to: allAddresses[i + 1],
        distanceMiles: parseFloat((meters * 0.000621371).toFixed(2)),
      });
    }

    const totalMiles = totalMeters * 0.000621371;
    const calculatedEndMileage = mileageLog.start_mileage + totalMiles;

    return new Response(
      JSON.stringify({
        success: true,
        totalMiles: parseFloat(totalMiles.toFixed(2)),
        calculatedEndMileage: parseFloat(calculatedEndMileage.toFixed(1)),
        startMileage: mileageLog.start_mileage,
        stopCount: taskAddresses.length,
        segments: segmentResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[calculate-route-mileage] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
