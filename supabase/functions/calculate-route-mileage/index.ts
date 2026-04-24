import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DRIVEABLE_STATUSES = new Set(["confirmed", "in_progress", "completed"]);

/** Fetch task rows for a specific date and return only those with driveable addresses. */
async function getTaskAddressesForDate(
  supabaseAdmin: ReturnType<typeof createClient>,
  date: string
): Promise<{ addresses: string[]; allRows: number; allStatuses: string[] }> {
  const { data: taskRows, error } = await supabaseAdmin
    .from("task_status")
    .select(`
      order_id,
      sort_order,
      orders (
        status,
        addresses ( line1, city, state, zip )
      )
    `)
    .eq("task_date", date)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("order_id", { ascending: true });

  if (error || !taskRows) return { addresses: [], allRows: 0, allStatuses: [] };

  const allStatuses = taskRows
    .map((r: any) => r.orders?.status)
    .filter(Boolean) as string[];

  const seenOrderIds = new Set<string>();
  const addresses: string[] = [];

  for (const row of taskRows) {
    const order = row.orders as any;
    if (!order || !DRIVEABLE_STATUSES.has(order.status)) continue;

    const orderId = row.order_id as string;
    if (seenOrderIds.has(orderId)) continue;
    seenOrderIds.add(orderId);

    const addr = order.addresses;
    if (addr?.line1 && addr?.city && addr?.state) {
      addresses.push(`${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip || ""}`.trim());
    }
  }

  return { addresses, allRows: taskRows.length, allStatuses };
}

/** Offset a YYYY-MM-DD string by `days` days. */
function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

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

    // Try the requested date first, then search ±1, ±2, ±3 days if no tasks are found.
    // This handles the common case where a mileage log is recorded the day after a job.
    const searchOffsets = [0, -1, 1, -2, 2, -3, 3];
    let taskAddresses: string[] = [];
    let resolvedDate = date;
    let lastDiagnostic = "";

    for (const offset of searchOffsets) {
      const candidateDate = offsetDate(date, offset);
      const result = await getTaskAddressesForDate(supabaseAdmin, candidateDate);

      if (result.addresses.length > 0) {
        taskAddresses = result.addresses;
        resolvedDate = candidateDate;
        break;
      }

      if (offset === 0) {
        // Build diagnostic for the originally requested date for use in the final error
        if (result.allRows === 0) {
          lastDiagnostic = `No tasks scheduled on ${date}.`;
        } else {
          const uniqueStatuses = [...new Set(result.allStatuses)];
          lastDiagnostic =
            `${result.allRows} task(s) on ${date} but none qualify — statuses found: ${uniqueStatuses.join(", ")}.`;
        }
      }
    }

    if (taskAddresses.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            `No qualifying tasks found within ±3 days of ${date}. ` +
            lastDiagnostic +
            ` Only confirmed, in_progress, or completed orders are included.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: homeBaseSetting } = await supabaseAdmin
      .from("admin_settings")
      .select("value")
      .eq("key", "home_base_address")
      .maybeSingle();

    const homeBase: string = homeBaseSetting?.value || "Wayne, MI 48184";

    const allAddresses = [homeBase, ...taskAddresses, homeBase];

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

    // Include resolvedDate so the client can inform the user if a nearby date was used
    return new Response(
      JSON.stringify({
        success: true,
        totalMiles: parseFloat(totalMiles.toFixed(2)),
        calculatedEndMileage: parseFloat(calculatedEndMileage.toFixed(1)),
        startMileage: mileageLog.start_mileage,
        stopCount: taskAddresses.length,
        segments: segmentResults,
        resolvedDate,
        usedNearbyDate: resolvedDate !== date,
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
