import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatOrderId } from "../_shared/format-order-id.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

Cancellation Reason:
${cancellationReason}

Please review and process any refund manually if applicable.
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
        const { data: smsTemplate } = await supabaseClient
          .from("sms_message_templates")
          .select("message_template")
          .eq("template_key", "order_cancelled_admin")
          .maybeSingle();

        if (smsTemplate) {
          const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
          const eventDateStr = new Date(order.event_date).toLocaleDateString();
          const orderLink = `${Deno.env.get("SUPABASE_URL")?.replace('/functions/v1', '').replace('https://supabase.co', '').replace('.supabase.co', '')}/admin?order=${orderId}`;

          const message = smsTemplate.message_template
            .replace("{customer_name}", customerName)
            .replace("{order_id}", formatOrderId(orderId))
            .replace("{event_date}", eventDateStr)
            .replace("{refund_policy}", "Pending Review")
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
        const eventDateStr = new Date(order.event_date).toLocaleDateString();

        const customerMessage = `Hi ${customerName}, your order #${formatOrderId(orderId)} for ${eventDateStr} has been cancelled.\n\nIf a refund is applicable, our team will review and process it within 3-5 business days. If you have any questions, please contact us. Thank you for choosing Bounce Party Club!`;

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
        refundPolicy: "pending_review",
        refundMessage: "Our team will review your cancellation and process any applicable refund within 3-5 business days.",
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
