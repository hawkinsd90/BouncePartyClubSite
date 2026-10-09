import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import { validateSiteEvent, MAX_SITE_EVENT_BODY_CHARS } from "../_shared/site-events.ts";

// Website analytics ingestion.
//
// The browser used to insert straight into site_events with the public key, which let anyone write unlimited, arbitrary rows.
// The table is now closed to anon / authenticated writes; this function is the only way in. It is public on purpose (visitors are
// anonymous), but it
//   - accepts only a fixed list of event names and a fixed set of small fields (see _shared/site-events.ts),
//   - never takes a timestamp, a user or a customer identity from the caller (created_at is the database's clock),
//   - rate limits per request address with the existing shared limiter, plus a ceiling on the total (no new identifier is collected),
//     and FAILS CLOSED: if the limiter cannot decide, nothing is written (503),
//   - validates before it writes, and writes with the service role.
// A rejected event is dropped with a generic answer; nothing about the table, the units or the orders is revealed.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Admission = { kind: "ok" } | { kind: "limited"; rate: { allowed: boolean; reason?: string; retry_after?: number } } | { kind: "unavailable" };

// One limiter decision. Anything other than a clear "allowed: true" - a denial, a limiter error, an exception, a missing or malformed
// answer - stops the request; only a clear denial is reported as a quota (429), everything else as the analytics being unavailable.
async function admit(endpoint: string, key: string): Promise<Admission> {
  let rate: unknown;
  try {
    rate = await checkRateLimit(endpoint, key, undefined, false, true);
  } catch {
    return { kind: "unavailable" };
  }
  if (!rate || typeof rate !== "object" || typeof (rate as { allowed?: unknown }).allowed !== "boolean") return { kind: "unavailable" };
  const r = rate as { allowed: boolean; reason?: string; retry_after?: number };
  if (r.allowed === true) return { kind: "ok" };
  if (r.reason === "limiter_unavailable") return { kind: "unavailable" };
  return { kind: "limited", rate: r };
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    // Abuse bound first, so a flood of junk costs one counter update each. Visitors behind one address share the allowance, which
    // is sized well above a real browsing session (see RATE_LIMIT_CONFIGS). Callers whose address is unknown share a single bucket.
    const ip = getIdentifier(req);
    const perAddress = await admit("record-site-event", buildRateLimitKey(ip, undefined, "record-site-event"));
    if (perAddress.kind === "unavailable") return respond(503, { success: false, error: "Analytics unavailable" });
    if (perAddress.kind === "limited") return createRateLimitResponse(perAddress.rate, corsHeaders);
    // The ceiling on the total, so the per-address allowance cannot be stretched by a caller that varies its apparent address.
    const overall = await admit("record-site-event-global", "record-site-event-global");
    if (overall.kind === "unavailable") return respond(503, { success: false, error: "Analytics unavailable" });
    if (overall.kind === "limited") return createRateLimitResponse(overall.rate, corsHeaders);

    const text = await req.text();
    if (text.length === 0 || text.length > MAX_SITE_EVENT_BODY_CHARS) return respond(400, { success: false, error: "Invalid event" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return respond(400, { success: false, error: "Invalid event" });
    }

    const event = validateSiteEvent(parsed);
    if (!event) return respond(400, { success: false, error: "Invalid event" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const row = { ...event };
    let { error } = await supabase.from("site_events").insert(row);
    // A unit or order id that does not exist is simply left off, so the answer never tells a caller which ids exist.
    if (error && error.code === "23503") {
      ({ error } = await supabase.from("site_events").insert({ ...row, unit_id: null, order_id: null }));
    }
    if (error) return respond(500, { success: false, error: "Could not record the event" });
    return respond(200, { success: true });
  } catch {
    return respond(500, { success: false, error: "Could not record the event" });
  }
});
