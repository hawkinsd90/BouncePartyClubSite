import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DRIVEABLE_STATUSES = new Set(["confirmed", "in_progress", "completed"]);

interface TaskStop {
  // "lat,lng" when available, otherwise full address string — both work in Distance Matrix
  waypoint: string;
  label: string;
}

/** Thrown when the database could not be read, so the caller says so instead of reporting an unrelated cause. */
class DataLoadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Fetch task rows for a specific date and return driveable stops with coordinates. One stop per task row. */
async function getTaskStopsForDate(
  supabaseAdmin: ReturnType<typeof createClient>,
  date: string
): Promise<{ stops: TaskStop[]; allRows: number; allStatuses: string[] }> {
  const { data: taskRows, error } = await supabaseAdmin
    .from("task_status")
    .select(`
      order_id,
      task_type,
      sort_order,
      orders (
        status,
        addresses ( line1, city, state, zip, lat, lng )
      )
    `)
    .eq("task_date", date)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("order_id", { ascending: true });

  // A failed read is reported as a failed read, never as "no tasks scheduled".
  if (error) throw new DataLoadError("TASKS_LOAD_FAILED", `Could not load the tasks for ${date}: ${error.message}`);
  if (!taskRows) return { stops: [], allRows: 0, allStatuses: [] };

  const allStatuses = taskRows
    .map((r: any) => r.orders?.status)
    .filter(Boolean) as string[];

  const stops: TaskStop[] = [];

  for (const row of taskRows) {
    const order = row.orders as any;
    if (!order || !DRIVEABLE_STATUSES.has(order.status)) continue;

    // One stop per task row: a drop-off and a pick-up of the same order on the same day are two visits, so two stops.
    const addr = order.addresses;
    if (!addr) continue;

    const kind = row.task_type === "pick-up" ? " (pick-up)" : row.task_type === "drop-off" ? " (drop-off)" : "";
    const label = `${addr.line1 || ""}, ${addr.city || ""}, ${addr.state || ""}`.trim() + kind;

    // Prefer lat/lng coordinates — much more reliable than address geocoding in Distance Matrix
    if (addr.lat && addr.lng) {
      stops.push({ waypoint: `${addr.lat},${addr.lng}`, label });
    } else if (addr.line1 && addr.city && addr.state) {
      stops.push({
        waypoint: `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip || ""}`.trim(),
        label,
      });
    }
  }

  return { stops, allRows: taskRows.length, allStatuses };
}

/** Google's own explanation for a refusal, with the key removed in case the provider echoes it. */
function providerMessage(data: any, key: string): string {
  const raw = typeof data?.error_message === "string" ? data.error_message : "";
  return key ? raw.split(key).join("[key]") : raw;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!callerToken) {
      return jsonResponse(401, { error: "Unauthorized: missing bearer token." });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(callerToken);
    if (userError || !user) {
      return jsonResponse(401, { error: "Unauthorized: invalid or expired token." });
    }

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    // A failed role read is not "no role": say the lookup failed.
    if (roleError) {
      console.error("[calculate-route-mileage] role lookup failed:", roleError.message);
      return jsonResponse(500, { error: `Could not verify your role: ${roleError.message}`, code: "ROLE_LOOKUP_FAILED" });
    }

    const role = roleRow?.role?.toLowerCase() ?? "";
    if (!["master", "admin", "crew"].includes(role)) {
      return jsonResponse(403, { error: "Forbidden: admin or crew role required." });
    }

    const body = await req.json();
    const { date, userId } = body;

    if (!date) {
      return jsonResponse(400, { error: "Missing required field: date (YYYY-MM-DD)" });
    }

    const targetUserId = userId || user.id;

    const { data: mileageLog, error: mileageError } = await supabaseAdmin
      .from("daily_mileage_logs")
      .select("start_mileage")
      .eq("date", date)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (mileageError) {
      console.error("[calculate-route-mileage] mileage log lookup failed:", mileageError.message);
      return jsonResponse(500, { error: `Could not load the start of day mileage: ${mileageError.message}`, code: "MILEAGE_LOOKUP_FAILED" });
    }

    // Only a missing reading counts as missing: a start reading of 0 is a reading.
    if (mileageLog?.start_mileage === null || mileageLog?.start_mileage === undefined) {
      return jsonResponse(422, { error: "Start of day mileage must be recorded before auto-calculating end mileage.", code: "START_MILEAGE_MISSING" });
    }
    const startMileage = Number(mileageLog.start_mileage);

    // The requested date and no other: tasks on a neighbouring day are a different day's route.
    const result = await getTaskStopsForDate(supabaseAdmin, date);
    const taskStops = result.stops;

    if (taskStops.length === 0) {
      let diagnostic: string;
      if (result.allRows === 0) {
        diagnostic = `No tasks scheduled on ${date}.`;
      } else {
        const uniqueStatuses = [...new Set(result.allStatuses)];
        diagnostic = `${result.allRows} task(s) on ${date} but none qualify — statuses found: ${uniqueStatuses.join(", ")}.`;
      }
      return jsonResponse(422, {
        error: `${diagnostic} Only confirmed, in_progress, or completed orders are included.`,
        code: "NO_QUALIFYING_TASKS",
      });
    }

    // Build home base waypoint — prefer lat/lng from settings for accuracy
    const { data: homeBaseSettings } = await supabaseAdmin
      .from("admin_settings")
      .select("key, value")
      .in("key", [
        "home_base_address", "business_address",
        "home_address_line1", "home_address_city", "home_address_state", "home_address_zip",
        "home_address_lat", "home_address_lng",
      ]);

    const sm: Record<string, string> = {};
    for (const row of homeBaseSettings ?? []) sm[row.key] = row.value;

    let homeWaypoint: string;
    if (sm["home_address_lat"] && sm["home_address_lng"]) {
      homeWaypoint = `${sm["home_address_lat"]},${sm["home_address_lng"]}`;
    } else if (sm["home_base_address"]) {
      homeWaypoint = sm["home_base_address"];
    } else if (sm["business_address"]) {
      homeWaypoint = sm["business_address"];
    } else if (sm["home_address_line1"]) {
      homeWaypoint = [sm["home_address_line1"], sm["home_address_city"], sm["home_address_state"], sm["home_address_zip"]]
        .filter(Boolean).join(", ");
    } else {
      homeWaypoint = "42.2808,-83.3863"; // Wayne, MI coordinates as last resort
    }

    const googleMapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
    if (!googleMapsKey) {
      return jsonResponse(500, { error: "Google Maps API key not configured on the server." });
    }

    // Build ordered waypoint list: home → stop1 → stop2 → ... → home
    const allWaypoints = [
      { waypoint: homeWaypoint, label: "Home Base" },
      ...taskStops,
      { waypoint: homeWaypoint, label: "Home Base" },
    ];

    let totalMeters = 0;
    const segmentResults: Array<{ from: string; to: string; distanceMiles: number }> = [];

    for (let i = 0; i < allWaypoints.length - 1; i++) {
      const origin = encodeURIComponent(allWaypoints[i].waypoint);
      const destination = encodeURIComponent(allWaypoints[i + 1].waypoint);

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&units=imperial&key=${googleMapsKey}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        return jsonResponse(502, { error: `Google Maps API request failed for segment ${i + 1}: HTTP ${resp.status}` });
      }

      const data = await resp.json();
      const element = data?.rows?.[0]?.elements?.[0];

      // Log full response for debugging
      console.log(`[segment ${i + 1}] waypoints: ${allWaypoints[i].waypoint} → ${allWaypoints[i + 1].waypoint}`);
      console.log(`[segment ${i + 1}] API status: ${data?.status}, element status: ${element?.status}`);
      console.log(`[segment ${i + 1}] full response:`, JSON.stringify(data));

      if (!element || element.status !== "OK") {
        const explanation = providerMessage(data, googleMapsKey);
        return jsonResponse(422, {
          error:
            `Could not calculate distance for segment ${i + 1}: ${allWaypoints[i].label} → ${allWaypoints[i + 1].label}. API status: ${data?.status ?? "unknown"}, Element status: ${element?.status ?? "unknown"}.` +
            (explanation ? ` Google says: ${explanation}` : "") +
            ` Waypoints used: ${allWaypoints[i].waypoint} → ${allWaypoints[i + 1].waypoint}`,
          code: "DISTANCE_LOOKUP_FAILED",
          providerStatus: data?.status ?? null,
          providerMessage: explanation || null,
        });
      }

      const meters = element.distance.value;
      totalMeters += meters;
      segmentResults.push({
        from: allWaypoints[i].label,
        to: allWaypoints[i + 1].label,
        distanceMiles: parseFloat((meters * 0.000621371).toFixed(2)),
      });
    }

    const totalMiles = totalMeters * 0.000621371;
    const calculatedEndMileage = startMileage + totalMiles;

    return jsonResponse(200, {
      success: true,
      totalMiles: parseFloat(totalMiles.toFixed(2)),
      calculatedEndMileage: parseFloat(calculatedEndMileage.toFixed(1)),
      startMileage,
      stopCount: taskStops.length,
      segments: segmentResults,
      // Kept for the client: the requested date is always the date used.
      resolvedDate: date,
      usedNearbyDate: false,
    });

  } catch (error: unknown) {
    if (error instanceof DataLoadError) {
      console.error("[calculate-route-mileage]", error.code, error.message);
      return jsonResponse(500, { error: error.message, code: error.code });
    }
    console.error("[calculate-route-mileage] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
});
