// GOOGLE CALENDAR SYNC — CURRENTLY DISABLED
//
// This function is scaffolded but intentionally inactive until Google OAuth
// credentials are configured. The DB trigger (trg_auto_sync_google_calendar)
// has been dropped so this function will not be invoked automatically.
//
// The function itself has an early-return guard at line ~276: if credentials
// are absent from admin_settings it returns { ok: false } immediately.
//
// TO RE-ENABLE:
// 1. Store Google credentials via Admin → Google Calendar tab.
// 2. Re-create the DB trigger (SQL in GoogleCalendarSettings.tsx file header).
// 3. Remove the GCAL_INTEGRATION_DISABLED constant from GoogleCalendarSettings.tsx.
// 4. Fix the queue-mark-before-sync ordering bug: move the processed_at update
//    to AFTER each syncDate() call succeeds, not before the loop.

import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const QUALIFYING_STATUSES = ["confirmed", "in_progress", "pending_review"];

// Reminder offsets relative to 08:00 AM on the event day
// Evening BEFORE at 6pm: 08:00 - 840min = 18:00 previous day
// Morning BEFORE at 9am: 08:00 - 1380min = 09:00 previous day
const EVENING_BEFORE_MINUTES = 840;
const MORNING_BEFORE_MINUTES = 1380;

async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }
  const data = await response.json();
  return data.access_token as string;
}

function buildReminders() {
  return {
    useDefault: false,
    overrides: [
      { method: "email", minutes: EVENING_BEFORE_MINUTES },
      { method: "popup", minutes: EVENING_BEFORE_MINUTES },
      { method: "email", minutes: MORNING_BEFORE_MINUTES },
      { method: "popup", minutes: MORNING_BEFORE_MINUTES },
    ],
  };
}

async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventDate: string,
  summary: string,
  description: string
): Promise<string> {
  const body = {
    summary,
    description,
    start: { date: eventDate },
    end: { date: eventDate },
    reminders: buildReminders(),
  };
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to create calendar event: ${err}`);
  }
  const data = await response.json();
  return data.id as string;
}

async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  eventDate: string,
  summary: string,
  description: string
): Promise<void> {
  const body = {
    summary,
    description,
    start: { date: eventDate },
    end: { date: eventDate },
    reminders: buildReminders(),
  };
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error("EVENT_NOT_FOUND");
    const err = await response.text();
    throw new Error(`Failed to update calendar event: ${err}`);
  }
}

async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok && response.status !== 404) {
    const err = await response.text();
    throw new Error(`Failed to delete calendar event: ${err}`);
  }
}

function buildEventContent(
  dateStr: string,
  orderCount: number,
  activeCount: number,
  customerNames: string[]
): { summary: string; description: string } {
  const summary = `BPC: ${activeCount} Active / ${orderCount} Total Orders`;
  const lines = [
    `Orders for ${dateStr}`,
    `Active: ${activeCount} | Total: ${orderCount}`,
    "",
  ];
  if (customerNames.length > 0) {
    lines.push("Customers:");
    customerNames.slice(0, 15).forEach((n) => lines.push(`  • ${n}`));
    if (customerNames.length > 15) {
      lines.push(`  • ...and ${customerNames.length - 15} more`);
    }
  }
  return { summary, description: lines.join("\n") };
}

async function syncDate(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  calendarId: string,
  dateStr: string
): Promise<string> {
  // Fetch qualifying orders for this date
  const { data: orders } = await supabase
    .from("orders")
    .select("id, status, customers(first_name, last_name)")
    .in("status", QUALIFYING_STATUSES)
    .eq("event_date", dateStr);

  const qualifyingOrders = orders || [];
  const activeOrders = qualifyingOrders.filter((o: any) =>
    ["confirmed", "in_progress"].includes(o.status)
  );

  // Fetch current sync row
  const { data: syncRow } = await supabase
    .from("google_calendar_sync")
    .select("*")
    .eq("event_date", dateStr)
    .maybeSingle();

  if (qualifyingOrders.length === 0) {
    if (syncRow?.google_event_id) {
      await deleteCalendarEvent(accessToken, calendarId, syncRow.google_event_id);
      await supabase
        .from("google_calendar_sync")
        .update({
          google_event_id: null,
          last_synced_at: new Date().toISOString(),
          last_sync_status: "ok",
          last_sync_error: null,
          order_count: 0,
        })
        .eq("event_date", dateStr);
      return "deleted";
    }
    return "noop";
  }

  const customerNames = qualifyingOrders.map((o: any) => {
    const c = o.customers as any;
    return c ? `${c.first_name} ${c.last_name}` : "Unknown";
  });

  const { summary, description } = buildEventContent(
    dateStr,
    qualifyingOrders.length,
    activeOrders.length,
    customerNames
  );

  let googleEventId = syncRow?.google_event_id;
  let action = "noop";

  if (!googleEventId) {
    googleEventId = await createCalendarEvent(accessToken, calendarId, dateStr, summary, description);
    action = "created";
  } else {
    try {
      await updateCalendarEvent(accessToken, calendarId, googleEventId, dateStr, summary, description);
      action = "updated";
    } catch (err: any) {
      if (err.message === "EVENT_NOT_FOUND") {
        googleEventId = await createCalendarEvent(accessToken, calendarId, dateStr, summary, description);
        action = "recreated";
      } else {
        throw err;
      }
    }
  }

  await supabase.from("google_calendar_sync").upsert(
    {
      event_date: dateStr,
      google_event_id: googleEventId,
      last_synced_at: new Date().toISOString(),
      last_sync_status: "ok",
      last_sync_error: null,
      order_count: qualifyingOrders.length,
    },
    { onConflict: "event_date" }
  );

  return action;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: { dates?: string[]; reconcile?: boolean } = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    // Fetch Google Calendar credentials from admin_settings
    const { data: settingsRows } = await supabase
      .from("admin_settings")
      .select("key, value")
      .in("key", [
        "google_calendar_client_id",
        "google_calendar_client_secret",
        "google_calendar_refresh_token",
        "google_calendar_id",
      ]);

    const settings: Record<string, string> = {};
    for (const row of settingsRows || []) {
      if (row.value) settings[row.key] = row.value;
    }

    const clientId = settings["google_calendar_client_id"];
    const clientSecret = settings["google_calendar_client_secret"];
    const refreshToken = settings["google_calendar_refresh_token"];
    const calendarId = settings["google_calendar_id"] || "primary";

    if (!clientId || !clientSecret || !refreshToken) {
      console.warn("[GCAL] Credentials not configured. Skipping.");
      // Still drain queue entries so they don't pile up
      await supabase
        .from("google_calendar_sync_queue")
        .update({ processed_at: new Date().toISOString() })
        .is("processed_at", null);
      return new Response(
        JSON.stringify({ ok: false, error: "Google Calendar credentials not configured in admin_settings" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getGoogleAccessToken(clientId, clientSecret, refreshToken);

    // Determine dates to sync
    let datesToSync: string[] = body.dates || [];

    if (datesToSync.length === 0) {
      if (body.reconcile) {
        // Full reconciliation: upcoming 90 days
        const today = new Date().toISOString().split("T")[0];
        const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const [ordersRes, syncRes] = await Promise.all([
          supabase
            .from("orders")
            .select("event_date")
            .in("status", QUALIFYING_STATUSES)
            .gte("event_date", today)
            .lte("event_date", ninetyDaysOut),
          supabase
            .from("google_calendar_sync")
            .select("event_date")
            .gte("event_date", today),
        ]);

        const allDates = new Set<string>([
          ...(ordersRes.data || []).map((o: any) => o.event_date),
          ...(syncRes.data || []).map((r: any) => r.event_date),
        ]);
        datesToSync = Array.from(allDates);
      } else {
        // Drain the queue (trigger-driven mode)
        const { data: queueRows } = await supabase
          .from("google_calendar_sync_queue")
          .select("id, event_date")
          .is("processed_at", null)
          .order("queued_at", { ascending: true })
          .limit(50);

        if (!queueRows || queueRows.length === 0) {
          return new Response(
            JSON.stringify({ ok: true, processed: 0, results: [] }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Deduplicate dates from queue
        const uniqueDates = new Set(queueRows.map((r: any) => r.event_date));
        datesToSync = Array.from(uniqueDates) as string[];

        // Mark all these queue rows as processed
        const queueIds = queueRows.map((r: any) => r.id);
        await supabase
          .from("google_calendar_sync_queue")
          .update({ processed_at: new Date().toISOString(), attempts: 1 })
          .in("id", queueIds);
      }
    }

    const results: Array<{ date: string; action: string; error?: string }> = [];

    for (const dateStr of datesToSync) {
      try {
        const action = await syncDate(supabase, accessToken, calendarId, dateStr);
        results.push({ date: dateStr, action });
      } catch (err: any) {
        console.error(`[GCAL] Error syncing ${dateStr}:`, err.message);
        await supabase.from("google_calendar_sync").upsert(
          {
            event_date: dateStr,
            last_synced_at: new Date().toISOString(),
            last_sync_status: "error",
            last_sync_error: err.message,
          },
          { onConflict: "event_date" }
        );
        results.push({ date: dateStr, action: "error", error: err.message });
      }
    }

    // console.log(`[GCAL] Sync complete. ${results.length} dates processed.`);

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[GCAL] Fatal error:", err.message);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
