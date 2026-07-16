import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  checkRateLimit,
  createRateLimitResponse,
  getIdentifier,
  buildRateLimitKey,
} from "../_shared/rate-limit.ts";
import { validatePaymentMethod } from "../_shared/payment-validation.ts";
import { formatCurrency } from "../_shared/fmt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  // Hoisted so the outer catch can release the claim sentinel on unexpected errors.
  let releaseClaim: (() => Promise<void>) | null = null;

  try {
    const body = await req.json();
    const {
      orderId,
      paymentAmountCents: requestPaymentAmountCents,
      tipCents: requestTipCents,
      selectedPaymentType: requestSelectedPaymentType,
    } = body;

    const ip = getIdentifier(req);
    const identifier = buildRateLimitKey(ip, orderId, "deposit");

    if (!ip && !orderId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request: unable to identify client",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const rateLimitResult = await checkRateLimit(
      "charge-deposit",
      identifier,
      undefined,
      true
    );

    if (!rateLimitResult.allowed) {
      if (rateLimitResult.reason === "missing_identifier") {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid request: unable to identify client",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing orderId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ success: false, error: "Stripe not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Scalar-only fetch — no nested joins in the critical path
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select(
        "id, stripe_customer_id, stripe_payment_method_id, deposit_due_cents, tip_cents, deposit_paid_cents, status, customer_selected_payment_cents, customer_selected_payment_type, subtotal_cents, travel_fee_cents, surface_fee_cents, same_day_pickup_fee_cents, generator_fee_cents, tax_cents, event_date, event_end_date"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      console.error("[charge-deposit] Order query error:", orderError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Order query failed: ${orderError.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch custom fees in a separate guarded query (non-fatal)
    let customFeesCents = 0;
    try {
      const { data: customFees } = await supabaseClient
        .from("order_custom_fees")
        .select("amount_cents")
        .eq("order_id", orderId);

      customFeesCents = (customFees || []).reduce(
        (sum: number, f: { amount_cents: number }) => sum + (f.amount_cents || 0),
        0
      );
    } catch (feeQueryErr) {
      console.error(
        "[charge-deposit] Custom fees query failed (non-fatal):",
        feeQueryErr
      );
    }

    // Fetch discounts from order_discounts table (discount_cents does not exist on orders)
    let discountCents = 0;
    try {
      const { data: orderDiscounts } = await supabaseClient
        .from("order_discounts")
        .select("amount_cents, percentage")
        .eq("order_id", orderId);

      discountCents = (orderDiscounts || []).reduce(
        (sum: number, d: { amount_cents: number; percentage: number }) => {
          if (d.percentage > 0) {
            return sum + Math.round((order.subtotal_cents || 0) * (d.percentage / 100));
          }
          if (d.amount_cents > 0) return sum + d.amount_cents;
          return sum;
        },
        0
      );
    } catch (discountQueryErr) {
      console.error(
        "[charge-deposit] Discounts query failed (non-fatal):",
        discountQueryErr
      );
    }

    if (!order.stripe_customer_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment method on file for this order",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let resolvedPaymentMethodId = order.stripe_payment_method_id;

    if (!resolvedPaymentMethodId) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: order.stripe_customer_id,
          type: "card",
          limit: 1,
        });

        if (paymentMethods.data.length > 0) {
          resolvedPaymentMethodId = paymentMethods.data[0].id;

          await supabaseClient
            .from("orders")
            .update({ stripe_payment_method_id: resolvedPaymentMethodId })
            .eq("id", orderId);

          // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
          // Restore only after a true dev/staging environment and explicit safe gating are in place.
          // Previously logged a Stripe payment method ID (pm_xxx) which is a sensitive payment token.
          // console.log(`[charge-deposit] Resolved missing payment method from Stripe customer: ${resolvedPaymentMethodId}`);
          // console.log("[charge-deposit] Resolved missing payment method from Stripe customer.");
        }
      } catch (pmLookupError) {
        console.error("[charge-deposit] Failed to look up payment methods:", pmLookupError);
      }
    }

    if (!resolvedPaymentMethodId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No payment method on file for this order",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use request values as source of truth; fall back to DB values
    const paymentAmountCents =
      typeof requestPaymentAmountCents === "number" && requestPaymentAmountCents > 0
        ? requestPaymentAmountCents
        : order.customer_selected_payment_cents || order.deposit_due_cents;

    const tipCents =
      typeof requestTipCents === "number"
        ? requestTipCents
        : (order.tip_cents ?? 0);

    const persistedPaymentType =
      typeof requestSelectedPaymentType === "string" && requestSelectedPaymentType
        ? requestSelectedPaymentType
        : order.customer_selected_payment_type || "deposit";

    if (!paymentAmountCents || paymentAmountCents <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No deposit amount configured for this order",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If already paid (positive value), persist the latest payment selection and confirm (avoid double charge)
    if (order.deposit_paid_cents && order.deposit_paid_cents > 0 && order.deposit_paid_cents >= paymentAmountCents) {
      const alreadyPaidUpdate: Record<string, unknown> = {
        status: "confirmed",
        customer_selected_payment_cents: paymentAmountCents,
        customer_selected_payment_type: persistedPaymentType,
        tip_cents: tipCents,
      };

      const { error: updateError } = await supabaseClient
        .from("orders")
        .update(alreadyPaidUpdate)
        .eq("id", orderId);

      if (updateError) {
        console.error("Failed to update order status:", updateError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to update order: ${updateError.message}`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      try {
        const { data: lcData, error: lcError } = await supabaseClient.functions.invoke("order-lifecycle", {
          body: {
            action: "enter_confirmed",
            orderId,
            source: "charge_deposit_already_paid",
            paymentOutcome: "already_paid",
            oldStatusHint: order.status,
          },
        });
        if (lcError) {
          console.error("[charge-deposit] order-lifecycle transport error (already_paid):", lcError);
        } else if (lcData && !lcData.success && !lcData.alreadySent) {
          console.error("[charge-deposit] order-lifecycle returned success=false (already_paid):", lcData.error);
        }
      } catch (lifecycleErr) {
        console.error("[charge-deposit] order-lifecycle invoke threw (non-fatal):", lifecycleErr);
      }

      return new Response(
        JSON.stringify({ success: true, alreadyCharged: true }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Server-side availability check before charging — last line of defense
    try {
      const { data: orderItemRows } = await supabaseClient
        .from("order_items")
        .select("unit_id")
        .eq("order_id", orderId);

      if (orderItemRows && orderItemRows.length > 0) {
        const BLOCKED_STATUSES = [
          "pending_review",
          "awaiting_customer_approval",
          "approved",
          "confirmed",
          "in_progress",
          "completed",
        ];

        for (const item of orderItemRows as { unit_id: string }[]) {
          const { data: conflicts } = await supabaseClient
            .from("order_items")
            .select("order_id, orders!inner(id, event_date, event_end_date, status)")
            .eq("unit_id", item.unit_id)
            .neq("order_id", orderId)
            .in("orders.status", BLOCKED_STATUSES);

          const eventStart = new Date(order.event_date ?? "");
          const eventEnd = new Date(order.event_end_date ?? order.event_date ?? "");

          const hasConflict = (conflicts ?? []).some((c: any) => {
            const o = c.orders;
            if (!o) return false;
            const oStart = new Date(o.event_date);
            const oEnd = new Date(o.event_end_date ?? o.event_date);
            return (
              (eventStart >= oStart && eventStart <= oEnd) ||
              (eventEnd >= oStart && eventEnd <= oEnd) ||
              (eventStart <= oStart && eventEnd >= oEnd)
            );
          });

          if (hasConflict) {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  "One or more items in this order are no longer available for the event date. Please contact support to reschedule.",
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
        }
      }
    } catch (availabilityErr) {
      console.error("[charge-deposit] Availability check error:", availabilityErr);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unable to verify item availability. Please try again or contact support.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Atomic race guard: claim this order for charging by doing a conditional UPDATE.
    // We set deposit_paid_cents = -1 (sentinel) only if it is currently 0 or NULL.
    // Using lte(0) covers both NULL (column default is 0) and explicit 0.
    // If two concurrent calls race here, exactly one will update 1 row; the other
    // gets 0 rows and must abort — preventing a double Stripe charge.
    const { data: claimedRows, error: claimError } = await supabaseClient
      .from("orders")
      .update({ deposit_paid_cents: -1 })
      .eq("id", orderId)
      .lte("deposit_paid_cents", 0)
      .select("id");

    if (claimError) {
      console.error("[charge-deposit] Claim update failed (code:", claimError.code, "message:", claimError.message, "details:", claimError.details, ")");
      return new Response(
        JSON.stringify({ success: false, error: "Failed to claim order for payment. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!claimedRows || claimedRows.length === 0) {
      // Another process already claimed or charged this order
      return new Response(
        JSON.stringify({ success: false, error: "This order is already being processed. Please refresh and try again." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper: roll back the sentinel on any pre-charge failure so the order
    // can be retried. Only called BEFORE stripe.paymentIntents.create fires.
    // Also assigned to the outer-scope variable so the catch block can use it.
    releaseClaim = async () => {
      try {
        await supabaseClient
          .from("orders")
          .update({ deposit_paid_cents: 0 })
          .eq("id", orderId)
          .eq("deposit_paid_cents", -1);
      } catch (e) {
        console.error("[charge-deposit] Failed to release claim sentinel:", e);
      }
    };

    const validation = await validatePaymentMethod(resolvedPaymentMethodId, stripe);

    if (!validation.valid) {
      await releaseClaim();
      return new Response(
        JSON.stringify({
          success: false,
          error: validation.reason,
          needsNewCard: validation.needsNewCard,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (validation.expMonth && validation.expYear && validation.last4) {
      await supabaseClient
        .from("orders")
        .update({
          payment_method_validated_at: new Date().toISOString(),
          payment_method_exp_month: validation.expMonth,
          payment_method_exp_year: validation.expYear,
          payment_method_last_four: validation.last4,
        })
        .eq("id", orderId);
    }

    // Charge the payment amount + tip
    // IMPORTANT: Tip is ONLY added to the charge amount, NOT to deposit_paid_cents
    const chargeAmountCents = paymentAmountCents + tipCents;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeAmountCents,
      currency: "usd",
      customer: order.stripe_customer_id,
      payment_method: resolvedPaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        order_id: orderId,
        payment_type: "deposit",
      },
    });

    if (paymentIntent.status !== "succeeded") {
      // For non-succeeded statuses (requires_action, processing, etc.),
      // the charge has NOT completed — release the sentinel so the order
      // can be retried. Include PI id so support can look up the attempt.
      await releaseClaim();
      return new Response(
        JSON.stringify({
          success: false,
          error: `Payment could not be completed (status: ${paymentIntent.status}). Please try again or contact support.`,
          paymentIntentId: paymentIntent.id,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ---- Stripe charge succeeded — all failures below must NOT return decline UI ----

    // Recalculate balance_due_cents
    const orderTotal =
      (order.subtotal_cents || 0) +
      (order.travel_fee_cents || 0) +
      (order.surface_fee_cents || 0) +
      (order.same_day_pickup_fee_cents || 0) +
      (order.generator_fee_cents || 0) +
      (order.tax_cents || 0) +
      customFeesCents -
      discountCents;

    const newBalanceDue = Math.max(0, orderTotal - paymentAmountCents);

    // Update order status + payment fields atomically.
    // Status write is intentionally co-located with the payment fields write so that
    // a subsequent non-fatal lifecycle failure cannot leave a charged order stuck in
    // a pre-confirmed state. Lifecycle is called after to handle admin alerting and
    // changelog only — it is NOT the sole owner of the status transition here.
    // IMPORTANT: deposit_paid_cents should NOT include tip
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        status: "confirmed",
        deposit_paid_cents: paymentAmountCents,
        stripe_payment_status: "paid",
        balance_due_cents: newBalanceDue,
        tip_cents: tipCents,
        customer_selected_payment_cents: paymentAmountCents,
        customer_selected_payment_type: persistedPaymentType,
      })
      .eq("id", orderId);

    if (updateError) {
      // Stripe already charged — signal partial success so frontend does NOT show decline UI.
      // Write a changelog entry so admins can query for stuck orders.
      console.error("[charge-deposit] Post-charge order update failed:", updateError);
      try {
        await supabaseClient.from("order_changelog").insert({
          order_id: orderId,
          user_id: null,
          change_type: "payment_error",
          field_changed: "deposit_paid_cents",
          old_value: "-1",
          new_value: String(paymentAmountCents),
          notes: `PARTIAL_CHARGE_FAILURE: Stripe charged ${chargeAmountCents} cents (PI: ${paymentIntent.id}) but order DB update failed: ${updateError.message}`,
        });
      } catch (clErr) {
        console.error("[charge-deposit] Failed to write partial-charge changelog (non-fatal):", clErr);
      }
      return new Response(
        JSON.stringify({
          success: false,
          chargeSucceeded: true,
          error: "Payment was processed but order update failed. Please contact support.",
          paymentIntentId: paymentIntent.id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Invoke lifecycle for admin alerting and changelog (non-fatal — charge already succeeded)
    try {
      const { data: lcData, error: lcError } = await supabaseClient.functions.invoke("order-lifecycle", {
        body: {
          action: "enter_confirmed",
          orderId,
          source: "charge_deposit",
          paymentOutcome: "charged_now",
          oldStatusHint: order.status,
        },
      });
      if (lcError) {
        console.error("[charge-deposit] order-lifecycle transport error (charged_now):", lcError);
      } else if (lcData && !lcData.success && !lcData.alreadySent) {
        console.error("[charge-deposit] order-lifecycle returned success=false (charged_now):", lcData.error);
      }
    } catch (lifecycleErr) {
      console.error("[charge-deposit] order-lifecycle invoke threw (non-fatal):", lifecycleErr);
    }

    // Get payment method details and Stripe fees
    let paymentMethod = null;
    let paymentBrand = null;
    let paymentLast4 = null;
    let stripeFee = 0;
    let stripeNet = chargeAmountCents;

    if (paymentIntent.payment_method) {
      const pmId =
        typeof paymentIntent.payment_method === "string"
          ? paymentIntent.payment_method
          : paymentIntent.payment_method.id;

      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);

        if (pm.type === "card" && pm.card) {
          paymentMethod = "card";
          paymentBrand = pm.card.brand;
          paymentLast4 = pm.card.last4;
        } else if (pm.type === "us_bank_account") {
          paymentMethod = "bank_account";
          paymentLast4 = pm.us_bank_account?.last4;
        } else {
          paymentMethod = pm.type;
        }
      } catch (pmError) {
        console.error("Failed to retrieve payment method details:", pmError);
      }
    }

    if (paymentIntent.latest_charge) {
      try {
        const chargeId =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge.id;

        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ["balance_transaction"],
        });

        const balanceTx = charge.balance_transaction;

        if (balanceTx && typeof balanceTx === "object") {
          stripeFee = balanceTx.fee || 0;
          stripeNet = balanceTx.net || chargeAmountCents;
        } else {
          console.warn("[Fees] balance_transaction not expanded, fees will be 0");
        }
      } catch (feeError) {
        console.error("Failed to retrieve Stripe fee data:", feeError);
      }
    }

    // Record payment — non-fatal (charge already succeeded)
    try {
      await supabaseClient.from("payments").insert({
        order_id: orderId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: chargeAmountCents,
        type: "deposit",
        status: "succeeded",
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod,
        payment_brand: paymentBrand,
        payment_last4: paymentLast4,
        stripe_fee_amount: stripeFee,
        stripe_net_amount: stripeNet,
        currency: "usd",
      });
    } catch (paymentError) {
      console.error("Failed to record payment (non-fatal):", paymentError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentDetails: {
          paymentIntentId: paymentIntent.id,
          chargeId: paymentIntent.latest_charge,
          amountCents: chargeAmountCents,
          paymentMethod,
          paymentBrand,
          paymentLast4,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("charge-deposit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // Best-effort: release the claim sentinel so the order is not stuck.
    // releaseClaim is only non-null if the claim was successfully taken.
    // It is safe to call here because the Stripe charge has not succeeded
    // if we are in this catch block (succeeded path never throws).
    if (releaseClaim) {
      await releaseClaim();
    }

    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});