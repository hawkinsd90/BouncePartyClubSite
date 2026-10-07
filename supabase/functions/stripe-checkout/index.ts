import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";
import {
  resolveCaller,
  isStaffAdmin,
  proveOrderAccess,
  isFreshBookingDraft,
  authFailureResponse,
} from "../_shared/auth.ts";
import { portalTokenFragment } from "../_shared/portal-link.ts";

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
    const { orderId, depositCents, tipCents = 0, customerEmail, customerName, setupMode = false, invoiceMode = false, invoiceLinkToken = null, paymentState = null, bookingMode = false } = body;
    const bodyOrigin: string | undefined = body.origin;

    const headerOrigin = req.headers.get("origin");
    const resolvedOrigin = headerOrigin || bodyOrigin || "https://bouncepartyclub.com";
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

    if (!orderId || (!depositCents && !setupMode && !bookingMode)) {
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
    //   - the public NEW-booking flow (bookingMode) for an order that is still an untouched booking draft: draft status,
    //     not an admin invoice, no Stripe customer or payment method attached yet, created within the last 2 hours.
    // A bare order UUID is never enough for an existing order.
    const caller = await resolveCaller(
      supabaseClient,
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );
    let authorizedToCreate = caller.kind === "service" || isStaffAdmin(caller);

    if (!authorizedToCreate) {
      const proof = await proveOrderAccess(supabaseClient, {
        orderId,
        caller,
        token: invoiceLinkToken,
        accept: ["token", "owner"],
      });
      authorizedToCreate = !!proof;
    }

    if (!authorizedToCreate && bookingMode === true) {
      authorizedToCreate = await isFreshBookingDraft(supabaseClient, orderId);
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
      apiVersion: "2024-10-28.acacia",
    });

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, stripe_customer_id, event_date, event_end_date, pickup_preference, location_type")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      if (blackoutResult?.is_full_blocked) {
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
        blackoutResult?.is_same_day_pickup_blocked &&
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

    // Create or retrieve Stripe customer
    let customerId = order.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          order_id: orderId,
        },
      });
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
            deposit_amount: depositCents ? depositCents.toString() : "0",
            tip_cents: tipCents.toString(),
          },
        }
      : setupMode
      ? {
          payment_method_types: ["card"],
          mode: "setup",
          customer: customerId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            order_id: orderId,
            payment_type: "card_update",
            deposit_amount: "0",
            tip_cents: tipCents.toString(),
          },
        }
      : {
          payment_method_types: ["card"],
          mode: "payment",
          customer: customerId,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: tipCents > 0 ? "Deposit + Tip" : "Deposit",
                },
                unit_amount: (depositCents ?? 0) + tipCents,
              },
              quantity: 1,
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            order_id: orderId,
            payment_type: "deposit",
            deposit_amount: depositCents ? depositCents.toString() : "0",
            tip_cents: tipCents.toString(),
          },
        };

    const session = await stripe.checkout.sessions.create(sessionParams);

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
