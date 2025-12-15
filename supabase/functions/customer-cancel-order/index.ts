import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-10-28.acacia",
});

interface CancelRequest {
  orderId: string;
  cancellationReason: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Customer can cancel anonymously via invoice link or as authenticated user
    const authHeader = req.headers.get("Authorization");
    let userId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      userId = user?.id || null;
    }

    const { orderId, cancellationReason }: CancelRequest = await req.json();

    if (!orderId || !cancellationReason || cancellationReason.trim().length < 10) {
      return new Response(
        JSON.stringify({
          error: "Order ID and cancellation reason (minimum 10 characters) are required"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get order details
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("*, customers(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if order can be cancelled
    const cancellableStatuses = ["draft", "pending_review", "awaiting_customer_approval", "confirmed"];
    if (!cancellableStatuses.includes(order.status)) {
      return new Response(
        JSON.stringify({
          error: "This order cannot be cancelled. It has already been delivered or is in progress."
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Calculate hours until event
    const now = new Date();
    const eventDate = new Date(order.start_date);
    const hoursUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Determine refund policy
    let refundPolicy: "full_refund" | "reschedule_credit" | "no_refund";
    let refundMessage: string;
    let shouldIssueRefund = false;

    // Check if it's the day of the event
    const isSameDay = eventDate.toDateString() === now.toDateString();

    if (hoursUntilEvent >= 72) {
      refundPolicy = "full_refund";
      refundMessage = "Your cancellation qualifies for a full refund. The refund will be processed automatically and should appear in your account within 5-10 business days.";
      shouldIssueRefund = true;
    } else if (isSameDay) {
      refundPolicy = "no_refund";
      refundMessage = "Since you're cancelling on the day of the event, unfortunately no refund or credit can be issued per our cancellation policy.";
      shouldIssueRefund = false;
    } else {
      refundPolicy = "reschedule_credit";
      refundMessage = "Since you're cancelling less than 72 hours before your event, your payment will be held as a credit that can be applied one time toward a rescheduled date within 12 months.";
      shouldIssueRefund = false;
    }

    // Update order status to cancelled
    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        status: "cancelled",
        cancellation_reason: cancellationReason,
        cancelled_at: new Date().toISOString(),
        cancelled_by: userId,
      })
      .eq("id", orderId);

    if (updateError) {
      throw new Error(`Failed to update order: ${updateError.message}`);
    }

    // Issue automatic refund if applicable
    let refundResult = null;
    if (shouldIssueRefund && refundPolicy === "full_refund") {
      // Get the total amount paid
      const { data: payments } = await supabaseClient
        .from("payments")
        .select("amount_cents")
        .eq("order_id", orderId)
        .eq("status", "succeeded");

      if (payments && payments.length > 0) {
        const totalPaid = payments.reduce((sum, p) => sum + p.amount_cents, 0);
        const alreadyRefunded = order.total_refunded_cents || 0;
        const refundAmount = totalPaid - alreadyRefunded;

        if (refundAmount > 0) {
          // Find payment to refund
          const { data: lastPayment } = await supabaseClient
            .from("payments")
            .select("*")
            .eq("order_id", orderId)
            .eq("status", "succeeded")
            .not("stripe_payment_intent_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (lastPayment && lastPayment.stripe_payment_intent_id) {
            try {
              const pi = await stripe.paymentIntents.retrieve(lastPayment.stripe_payment_intent_id);

              if (pi.status === "succeeded") {
                const refund = await stripe.refunds.create({
                  payment_intent: pi.id,
                  amount: refundAmount,
                  reason: "requested_by_customer",
                  metadata: {
                    order_id: orderId,
                    cancellation_reason: cancellationReason,
                  },
                });

                // Record refund
                await supabaseClient
                  .from("order_refunds")
                  .insert({
                    order_id: orderId,
                    amount_cents: refundAmount,
                    reason: `Customer cancellation: ${cancellationReason}`,
                    stripe_refund_id: refund.id,
                    refunded_by: userId,
                    status: refund.status === "succeeded" ? "succeeded" : "pending",
                  });

                // Update total refunded
                await supabaseClient
                  .from("orders")
                  .update({
                    total_refunded_cents: (order.total_refunded_cents || 0) + refundAmount,
                  })
                  .eq("id", orderId);

                refundResult = {
                  refunded: true,
                  amount: refundAmount,
                  refundId: refund.id,
                };
              }
            } catch (refundError: any) {
              console.error("Refund error:", refundError);
              // Don't fail the cancellation, just log the error
              refundResult = {
                refunded: false,
                error: "Refund processing failed, please contact support",
              };
            }
          }
        }
      }
    }

    // Send notification email to admin
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: order.customers?.email || "admin@bouncepartyclub.com",
          subject: `Order Cancelled: ${orderId}`,
          text: `
Order ${orderId} has been cancelled by the customer.

Customer: ${order.customers?.first_name} ${order.customers?.last_name}
Event Date: ${order.start_date}
Hours Until Event: ${hoursUntilEvent.toFixed(1)}
Refund Policy: ${refundPolicy}

Cancellation Reason:
${cancellationReason}

${refundResult?.refunded ? `Automatic refund of $${(refundResult.amount / 100).toFixed(2)} has been issued.` : refundMessage}
          `,
        }),
      });
    } catch (emailError) {
      console.error("Failed to send notification email:", emailError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your order has been cancelled.",
        refundPolicy,
        refundMessage,
        refundResult,
        hoursUntilEvent: hoursUntilEvent.toFixed(1),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Cancel order error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to cancel order",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});