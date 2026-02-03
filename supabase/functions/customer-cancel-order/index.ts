import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatOrderId } from "../_shared/format-order-id.ts";

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
  adminOverrideRefund?: boolean;
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

    const authHeader = req.headers.get("Authorization");
    let userId = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      userId = user?.id || null;
    }

    const { orderId, cancellationReason, adminOverrideRefund }: CancelRequest = await req.json();

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

    const now = new Date();
    const eventDate = new Date(order.event_date);
    const hoursUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    let refundPolicy: "full_refund" | "reschedule_credit" | "no_refund";
    let refundMessage: string;
    let shouldIssueRefund = false;

    const isSameDay = eventDate.toDateString() === now.toDateString();

    if (adminOverrideRefund !== undefined) {
      if (adminOverrideRefund) {
        refundPolicy = "full_refund";
        refundMessage = "A full refund has been issued by Bounce Party Club. The refund will be processed and should appear in your account within 5-10 business days.";
        shouldIssueRefund = true;
      } else {
        refundPolicy = "no_refund";
        refundMessage = "No refund has been issued for this cancellation. If you have any questions, please contact Bounce Party Club.";
        shouldIssueRefund = false;
      }
    } else if (hoursUntilEvent >= 72) {
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

    await supabaseClient
      .from("task_status")
      .delete()
      .eq("order_id", orderId);

    let refundResult = null;
    if (shouldIssueRefund && refundPolicy === "full_refund") {
      const { data: payments } = await supabaseClient
        .from("payments")
        .select("amount_cents")
        .eq("order_id", orderId)
        .eq("status", "succeeded");

      if (payments && payments.length > 0) {
        const totalPaid = payments.reduce((sum: number, p: { amount_cents: number }) => sum + p.amount_cents, 0);
        const alreadyRefunded = order.total_refunded_cents || 0;
        const refundAmount = totalPaid - alreadyRefunded;

        if (refundAmount > 0) {
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
            } catch (refundError: unknown) {
              console.error("Refund error:", refundError);
              refundResult = {
                refunded: false,
                error: "Refund processing failed, please contact support",
              };
            }
          }
        }
      }
    }

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
Event Date: ${order.event_date}
Hours Until Event: ${hoursUntilEvent.toFixed(1)}
Refund Policy: ${refundPolicy}

Cancellation Reason:
${cancellationReason}

${refundResult?.refunded && refundResult.amount ? `Automatic refund of $${(refundResult.amount / 100).toFixed(2)} has been issued.` : refundMessage}
          `,
        }),
      });
    } catch (emailError) {
      console.error("Failed to send notification email:", emailError);
    }

    try {
      const { data: adminPhone } = await supabaseClient
        .from("admin_settings")
        .select("value")
        .eq("key", "admin_phone")
        .maybeSingle();

      if (adminPhone?.value) {
        const refundPolicyText =
          refundPolicy === "full_refund" ? "Full Refund" :
          refundPolicy === "reschedule_credit" ? "Credit Only" :
          "No Refund";

        const { data: smsTemplate } = await supabaseClient
          .from("sms_message_templates")
          .select("message_template")
          .eq("template_key", "order_cancelled_admin")
          .maybeSingle();

        if (smsTemplate) {
          const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
          const eventDate = new Date(order.event_date).toLocaleDateString();
          const orderLink = `${Deno.env.get("SUPABASE_URL")?.replace('/functions/v1', '').replace('https://supabase.co', '').replace('.supabase.co', '')}/admin?order=${orderId}`;

          const message = smsTemplate.message_template
            .replace("{customer_name}", customerName)
            .replace("{order_id}", formatOrderId(orderId))
            .replace("{event_date}", eventDate)
            .replace("{refund_policy}", refundPolicyText)
            .replace("{order_link}", orderLink);

          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-notification`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: adminPhone.value,
              message: message,
              orderId: orderId,
            }),
          });
        }
      }
    } catch (smsError) {
      console.error("Failed to send SMS notification to admin:", smsError);
    }

    try {
      if (order.customers?.phone) {
        const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
        const eventDate = new Date(order.event_date).toLocaleDateString();

        let customerMessage = `Hi ${customerName}, your order #${formatOrderId(orderId)} for ${eventDate} has been cancelled.\n\n`;

        if (shouldIssueRefund) {
          customerMessage += `✓ Full refund issued: Your refund will be processed and should appear in your account within 5-10 business days.`;
        } else if (refundPolicy === "reschedule_credit") {
          customerMessage += `Your payment has been converted to a credit that can be applied toward a rescheduled date within 12 months.`;
        } else {
          customerMessage += `No refund has been issued for this cancellation.`;
        }

        customerMessage += `\n\nIf you have any questions, please contact us. Thank you for choosing Bounce Party Club!`;

        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-notification`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: order.customers.phone,
            message: customerMessage,
            orderId: orderId,
          }),
        });
      }
    } catch (smsError) {
      console.error("Failed to send SMS notification to customer:", smsError);
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
  } catch (error: unknown) {
    console.error("Cancel order error:", error);
    const message = error instanceof Error ? error.message : "Failed to cancel order";
    const details = error instanceof Error ? error.toString() : String(error);
    return new Response(
      JSON.stringify({
        error: message,
        details: details,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});