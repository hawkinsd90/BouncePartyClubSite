import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// What the check_date_blackout RPC returns (TABLE(is_full_blocked boolean, is_same_day_pickup_blocked boolean)).
interface BlackoutResult {
  is_full_blocked: boolean | null;
  is_same_day_pickup_blocked: boolean | null;
}
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import {
  resolveCaller,
  isStaffAdmin,
  proveOrderAccess,
  authFailureResponse,
} from "../_shared/auth.ts";
import { portalTokenFragment } from "../_shared/portal-link.ts";
import { checkBookingProof, claimBookingProof, consumeBookingProof, releaseBookingProof } from "../_shared/booking/bookingProof.ts";
import { resolveReturnOrigin } from "../_shared/booking/returnOrigin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();
    const { orderId, tipCents = 0, customerEmail, customerName, setupMode = false, invoiceMode = false, invoiceLinkToken = null, paymentState = null, bookingMode = false } = body;
    const bodyOrigin: string | undefined = body.origin;

    // Stripe return URLs are built only from an allowlisted origin (production, SITE_URL / RETURN_ORIGINS, loopback dev).
    const headerOrigin = req.headers.get("origin");
    const resolvedOrigin = resolveReturnOrigin(
      [headerOrigin, bodyOrigin],
      [Deno.env.get("SITE_URL"), Deno.env.get("RETURN_ORIGINS")],
    );
    console.log("stripe-checkout: origin — header:", headerOrigin ?? "null", "| body:", bodyOrigin ?? "null", "| resolved:", resolvedOrigin);

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, 'checkout');

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rateLimitResult = await checkRateLimit('stripe-checkout', identifier, undefined, true);

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === 'missing_identifier') {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid request: unable to identify client' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── Authorization (Payment Safety A1 corrective) ────────────────────────
    // A completed Checkout session whose metadata.order_id names an order is accepted elsewhere as proof of control of
    // that order (charge-deposit, order-lifecycle, save-payment-method-from-session). That is only sound if an
    // untrusted caller cannot get a session created for an arbitrary existing order, so creation is gated here.
    //
    // Allowed to create a session for an order:
    //   - the backend (service role) or a signed-in admin/master;
    //   - a customer proving control of THIS order: an unexpired invoice/portal link token bound to it (invoice,
    //     card-update and payment flows) or a signed-in customer who owns it;
    //   - the public NEW-booking flow (bookingMode): the server-minted, order-bound, short-lived, single-use booking
    //     proof that create-booking returned with the order (see _shared/booking/bookingProof.ts). A portal or invoice
    //     token is NOT a booking proof and a booking proof is not a portal or invoice token.
    // A bare order UUID, and the order's own state ("it looks like a fresh draft"), are never enough.
    const caller = await resolveCaller(
      supabaseClient,
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    let authorizedToCreate = caller.kind === "service" || isStaffAdmin(caller);

    const bookingToken: unknown = body.bookingToken;
    let viaBookingProof = false;

    if (!authorizedToCreate && bookingMode !== true) {
      const proof = await proveOrderAccess(supabaseClient, {
        orderId,
        caller,
        token: invoiceLinkToken,
        accept: ["token", "owner"],
      });
      authorizedToCreate = !!proof;
    }

    if (!authorizedToCreate && bookingMode === true) {
      const proofCheck = await checkBookingProof(supabaseClient, orderId, bookingToken);
      if (proofCheck.ok) {
        authorizedToCreate = true;
        viaBookingProof = true;
      } else if (proofCheck.reason === "expired") {
        return new Response(
          JSON.stringify({ success: false, error: "This booking checkout link has expired. Please submit your booking again.", code: "BOOKING_PROOF_EXPIRED" }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (proofCheck.reason === "consumed") {
        return new Response(
          JSON.stringify({ success: false, error: "Card setup was already started for this booking.", code: "BOOKING_PROOF_USED" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!authorizedToCreate) {
      console.warn(
        `[stripe-checkout] rejected: caller=${caller.kind}${caller.kind === "user" ? ` user=${caller.userId}` : ""} mode=${bookingMode ? "booking" : setupMode ? "setup" : "payment"} reason=no_order_proof`
      );
      return authFailureResponse(
        { ok: false, status: caller.kind === "anonymous" ? 401 : 403, error: "Not authorized for this order." },
        corsHeaders
      );
    }

    // This function only saves a card (booking request, invoice card save, card update). It never creates a charge: the
    // payment mode that used to take a deposit and tip amount from the request has no caller and is retired. Money is
    // collected by payment operations (charge-deposit, customer-balance-payment) whose amounts the server derives.
    if (setupMode !== true && bookingMode !== true) {
      return new Response(
        JSON.stringify({ success: false, code: "PAYMENT_MODE_RETIRED", error: "Payment mode is no longer available." }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ success: false, error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia" as unknown as Stripe.LatestApiVersion,
    });

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, status, customer_id, stripe_customer_id, deposit_due_cents, tip_cents, event_date, event_end_date, pickup_preference, location_type")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // A booking-proof caller may only start card setup for a booking request that is still an untouched draft.
    if (viaBookingProof && order.status !== "draft") {
      return new Response(
        JSON.stringify({ success: false, error: "Card setup is not available for this booking." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // In booking mode every fact comes from the order row, never from the request body.
    let stripeEmail: string | undefined = customerEmail;
    let stripeName: string | undefined = customerName;
    let sessionDepositCents = 0;
    let sessionTipCents: number = typeof tipCents === "number" ? tipCents : 0;
    if (bookingMode === true) {
      const { data: bookingCustomer } = await supabaseClient
        .from("customers")
        .select("first_name, last_name, email")
        .eq("id", order.customer_id ?? "")
        .maybeSingle();
      stripeEmail = bookingCustomer?.email ?? undefined;
      stripeName = bookingCustomer ? `${bookingCustomer.first_name} ${bookingCustomer.last_name}`.trim() : undefined;
      sessionDepositCents = typeof order.deposit_due_cents === "number" ? order.deposit_due_cents : 0;
      sessionTipCents = typeof order.tip_cents === "number" ? order.tip_cents : 0;
    }

    // TRUSTED ENFORCEMENT: Check blackout dates before creating any Stripe session.
    // This gate cannot be bypassed — it runs server-side under the service role key.
    // Only skip for setup mode (card-on-file updates), which have no event date context.
    if (!setupMode && order.event_date) {
      const startDate = order.event_date.substring(0, 10);
      const endDate = (order.event_end_date || order.event_date).substring(0, 10);

      const { data: blackoutResult, error: blackoutError } = await supabaseClient
        .rpc("check_date_blackout", { p_start: startDate, p_end: endDate })
        .maybeSingle();

      if (blackoutError) {
        console.error("stripe-checkout: blackout check error:", blackoutError);
        return new Response(
          JSON.stringify({ success: false, error: "Unable to verify date availability. Please try again." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if ((blackoutResult as BlackoutResult | null)?.is_full_blocked) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "This date is not available for booking. Please contact us or choose a different date.",
            code: "DATE_BLACKED_OUT",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (
        (blackoutResult as BlackoutResult | null)?.is_same_day_pickup_blocked &&
        (order.pickup_preference === "same_day" || order.location_type === "commercial")
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Same-day pickups are not available for this date. Please choose next-day pickup or select a different date.",
            code: "SAME_DAY_PICKUP_BLACKED_OUT",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Booking proof: claim it only now that every validation has passed. The claim is released if Stripe fails (so the
    // customer can retry) and consumed once the session exists. A concurrent request cannot claim a claimed proof.
    let claim: { proofId: string; claimId: string } | null = null;
    if (viaBookingProof) {
      const claimed = await claimBookingProof(supabaseClient, orderId, bookingToken);
      if (!claimed.ok) {
        // busy = another request holds the claim; consumed = another request just finished (single use).
        const conflict = claimed.reason === "busy" || claimed.reason === "consumed";
        const expired = claimed.reason === "expired";
        return new Response(
          JSON.stringify({
            success: false,
            error: conflict ? "Card setup is already being started for this booking." : expired ? "This booking checkout link has expired. Please submit your booking again." : "Not authorized for this order.",
          }),
          { status: conflict ? 409 : expired ? 410 : 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      claim = { proofId: claimed.proofId, claimId: claimed.claimId };
    }

    // Public booking sessions are created with a Stripe idempotency key derived from the persisted proof id (never the
    // token): if Stripe succeeds but the database consume write fails, any retry of the same proof gets the SAME Checkout
    // Session back instead of minting a second one. Other flows are unchanged.
    const bookingIdempotency = (scope: string) => (claim ? { idempotencyKey: `booking-${scope}-${claim.proofId}` } : undefined);

    let session: Stripe.Checkout.Session;
    try {
    // Create or retrieve Stripe customer
    let customerId = order.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: stripeEmail,
        name: stripeName,
        metadata: {
          order_id: orderId,
        },
      }, bookingIdempotency("customer"));
      customerId = customer.id;

      // Save customer ID to order
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Use setup mode to save card on file (no charge yet)
    // If setupMode (card update), redirect back to customer portal with approval modal trigger
    // Encode payment state in URL so it survives the Stripe redirect
    // Order-bound proof for token-authenticated portal visits rides in the URL fragment (never in the query string).
    const returnFragment = portalTokenFragment(invoiceLinkToken);
    let successUrl: string;
    if (bookingMode) {
      successUrl = `${resolvedOrigin}/payment-complete?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`;
    } else if (setupMode) {
      let params: URLSearchParams;
      if (invoiceMode) {
        successUrl = `${resolvedOrigin}/customer-portal/${orderId}?invoice_card_saved=true&session_id={CHECKOUT_SESSION_ID}${returnFragment}`;
      } else {
        params = new URLSearchParams({ card_updated: 'true' });
        if (paymentState) {
          if (paymentState.paymentAmount) params.set('pa', paymentState.paymentAmount);
          if (paymentState.customPaymentAmount) params.set('cpa', paymentState.customPaymentAmount);
          if (typeof paymentState.newTipCents === 'number') params.set('tip', String(paymentState.newTipCents));
          if (typeof paymentState.keepOriginalPayment === 'boolean') params.set('kop', paymentState.keepOriginalPayment ? '1' : '0');
          if (typeof paymentState.selectedPaymentBaseCents === 'number') params.set('spb', String(paymentState.selectedPaymentBaseCents));
        }
        successUrl = `${resolvedOrigin}/customer-portal/${orderId}?${params.toString()}&session_id={CHECKOUT_SESSION_ID}${returnFragment}`;
      }
    } else {
      successUrl = `${resolvedOrigin}/payment-complete?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`;
    }
    const cancelUrl = (setupMode && !bookingMode)
      ? `${resolvedOrigin}/customer-portal/${orderId}?card_update_canceled=true${returnFragment}`
      : `${resolvedOrigin}/payment-canceled?order_id=${orderId}`;

    // The return URLs can carry the portal link token (#t=...); never log it.
    const redactToken = (u: string) => u.replace(/([?&#]t=)[^&#]+/g, "$1[redacted]");
    console.log("stripe-checkout: urls — success:", redactToken(successUrl), "| cancel:", redactToken(cancelUrl));

    const sessionParams: Stripe.Checkout.SessionCreateParams = bookingMode
      ? {
          payment_method_types: ["card"],
          mode: "setup",
          customer: customerId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            order_id: orderId,
            payment_type: "booking_request",
            deposit_amount: sessionDepositCents ? sessionDepositCents.toString() : "0",
            tip_cents: sessionTipCents.toString(),
          },
        }
      : {
          payment_method_types: ["card"],
          mode: "setup",
          customer: customerId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            order_id: orderId,
            payment_type: "card_update",
            deposit_amount: "0",
            tip_cents: sessionTipCents.toString(),
          },
        };

    session = await stripe.checkout.sessions.create(sessionParams, bookingIdempotency("session"));
    } catch (stripeErr) {
      // Nothing was created for the customer to use: give the booking proof back so they can retry.
      if (claim) await releaseBookingProof(supabaseClient, claim.proofId, claim.claimId);
      throw stripeErr;
    }

    if (claim) {
      let consumed = await consumeBookingProof(supabaseClient, claim.proofId, claim.claimId);
      if (!consumed) consumed = await consumeBookingProof(supabaseClient, claim.proofId, claim.claimId);
      // If it still cannot be recorded the claim stays in place; a later retry resolves to this same Stripe session
      // through the idempotency key above, so the proof can never yield a second distinct session.
      if (!consumed) console.error("stripe-checkout: booking proof could not be marked consumed");
    }

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("stripe-checkout error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
