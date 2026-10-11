import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveCaller, requireRoles, authFailureResponse, isStaffAdmin, STAFF_ADMIN_ROLES, INVOICE_SENDER_ROLES } from "../_shared/auth.ts";
import { saveStaffOrderChanges, createStaffInvoiceOrder } from "../_shared/staff-order-save.ts";

// STAFF ORDER SAVE - the only way a staff member's pricing change reaches an order.
//
//   save_changes    Admin / Master: an edit of an existing order.
//   create_invoice  Admin / Master / Crew: a new DRAFT invoice order (Crew could already create and send invoices; this does not
//                   widen what Crew may do, it only makes the server the author of the prices). Crew gets catalog prices only: no
//                   adjusted line price, discount, custom fee, waiver, deposit or Setup Fee override, or card-on-file opt-out.
//
// The delivery distance is measured here (Google Distance Matrix, the same secret calculate-route-mileage uses); miles and
// coordinates sent by a browser are not part of the contract.
//
// The browser sends what the staff member CHANGED. The server prices it (see _shared/staff-order-save.ts). A request that carries
// a price is refused. There is no customer or anonymous access.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const caller = await resolveCaller(db, req.headers.get("Authorization"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return respond(400, { success: false, code: "INVALID_REQUEST", error: "Invalid request." });
    }
    const action = body?.action;
    if (action !== "save_changes" && action !== "create_invoice") return respond(400, { success: false, code: "INVALID_REQUEST", error: "Invalid request." });

    // A user identity is required (the service role is not a person and cannot author a staff save).
    const gate = requireRoles(caller, action === "save_changes" ? STAFF_ADMIN_ROLES : INVOICE_SENDER_ROLES, {
      unauthorized: "Unauthorized",
      forbidden: "Forbidden: staff access required.",
    });
    if (!gate.ok) {
      console.warn(`[staff-order-save] rejected: caller=${caller.kind} action=${action}`);
      return authFailureResponse(gate, corsHeaders, "error-only");
    }

    const payload: Record<string, unknown> = { ...body };
    delete payload.action;
    // The price-override capability is the verified caller's role (Admin / Master), never a field of the request.
    const deps = { db, actingUserId: gate.userId, canOverridePricing: isStaffAdmin(caller) };
    const result = action === "save_changes"
      ? await saveStaffOrderChanges(deps, payload)
      : await createStaffInvoiceOrder(deps, payload);
    return respond(result.status, result.body);
  } catch (error) {
    console.error("[staff-order-save] failed:", error instanceof Error ? error.message : "unknown");
    return respond(500, { success: false, code: "SAVE_FAILED", error: "The changes could not be saved." });
  }
});
