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
  adminOverrideRefund?: boolean;
  customerEmail?: string;
  invoiceLinkToken?: string;
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

    const { orderId, cancellationReason, adminOverrideRefund, customerEmail, invoiceLinkToken }: CancelRequest = await req.json();

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

    // Ownership check: anon callers must prove ownership.
    // Authenticated admins (userId != null) skip this check entirely.
    if (!userId) {
      if (invoiceLinkToken) {
        // Strong path: verify the cryptographic invoice link token.
        const { data: linkData, error: linkError } = await supabaseClient
          .from("invoice_links")
          .select("id, order_id, expires_at")
          .eq("link_token", invoiceLinkToken)
          .eq("order_id", orderId)
          .maybeSingle();

        if (linkError || !linkData) {
          return new Response(
            JSON.stringify({ error: "This cancellation link is not valid for this order" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
          return new Response(
            JSON.stringify({ error: "This cancellation link has expired. Please contact us to cancel your order." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Fallback path: email match for direct /customer-portal/:orderId sessions (no token issued).
        if (!customerEmail) {
          return new Response(
            JSON.stringify({ error: "Customer email is required to cancel this order" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const orderEmail = order.customers?.email ?? "";
        if (orderEmail.trim().toLowerCase() !== customerEmail.trim().toLowerCase()) {
          return new Response(
            JSON.stringify({ error: "The email address provided does not match this order" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
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
        refund_requested: adminOverrideRefund === true,
      })
      .eq("id", orderId);

    if (updateError) {
      throw new Error(`Failed to update order: ${updateError.message}`);
    }

    // Write cancellation audit trail to order_changelog
    try {
      await supabaseClient.from("order_changelog").insert({
        order_id: orderId,
        user_id: userId,
        change_type: "cancellation",
        field_changed: "status",
        old_value: order.status,
        new_value: "cancelled",
        notes: `Reason: ${cancellationReason}${adminOverrideRefund === true ? " | Refund requested: yes" : adminOverrideRefund === false ? " | Refund requested: no" : ""}`,
      });
    } catch (changelogError) {
      console.error("Failed to write cancellation changelog:", changelogError);
    }

    // Delete task_status rows for this order (pre-event route assignments)
    try {
      const { error: taskDeleteError } = await supabaseClient
        .from("task_status")
        .delete()
        .eq("order_id", orderId);
      if (taskDeleteError) {
        console.error("Failed to delete task_status rows:", taskDeleteError);
      }
    } catch (taskDeleteError) {
      console.error("task_status delete threw:", taskDeleteError);
    }

    // Fetch admin email and app URL from settings for notifications
    const [adminEmailSetting, adminPhoneSetting, appUrlSetting] = await Promise.all([
      supabaseClient.from("admin_settings").select("value").eq("key", "admin_email").maybeSingle(),
      supabaseClient.from("admin_settings").select("value").eq("key", "admin_phone").maybeSingle(),
      supabaseClient.from("admin_settings").select("value").eq("key", "app_url").maybeSingle(),
    ]);
    const adminEmail = adminEmailSetting.data?.value || "admin@bouncepartyclub.com";
    const adminPhone = adminPhoneSetting.data?.value;
    const appUrl = appUrlSetting.data?.value || "";
    const orderLink = appUrl ? `${appUrl}/admin?order=${orderId}` : `Order ID: ${formatOrderId(orderId)}`;

    const refundNote = adminOverrideRefund === true
      ? "Refund requested: YES — please issue refund from the Payments tab."
      : adminOverrideRefund === false
        ? "Refund requested: NO — no refund to be issued."
        : "Refund status: not specified — please review manually.";

    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: adminEmail,
          subject: `Order Cancelled: ${formatOrderId(orderId)}`,
          text: `
Order ${formatOrderId(orderId)} has been cancelled.

Customer: ${order.customers?.first_name} ${order.customers?.last_name}
Event Date: ${order.event_date}
Hours Until Event: ${hoursUntilEvent.toFixed(1)}
Cancelled By: ${userId ? `Admin (${userId})` : "Customer"}

Cancellation Reason:
${cancellationReason}

${refundNote}

Order Link: ${orderLink}
          `,
        }),
      });
    } catch (emailError) {
      console.error("Failed to send notification email:", emailError);
    }

    try {
      if (adminPhone) {
        const { data: smsTemplate } = await supabaseClient
          .from("sms_message_templates")
          .select("message_template")
          .eq("template_key", "order_cancelled_admin")
          .maybeSingle();

        if (smsTemplate) {
          const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
          const eventDateStr = new Date(order.event_date).toLocaleDateString();

          const message = smsTemplate.message_template
            .replace("{customer_name}", customerName)
            .replace("{order_id}", formatOrderId(orderId))
            .replace("{event_date}", eventDateStr)
            .replace("{refund_policy}", adminOverrideRefund === true ? "Refund Requested" : adminOverrideRefund === false ? "No Refund" : "Pending Review")
            .replace("{order_link}", orderLink);

          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-notification`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: adminPhone,
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

        // Only mention refund if there is a payment on this order
        const { data: payments } = await supabaseClient
          .from("payments")
          .select("id")
          .eq("order_id", orderId)
          .eq("status", "succeeded")
          .limit(1);
        const hasPayment = payments && payments.length > 0;

        const refundLine = hasPayment
          ? "\n\nIf a refund is applicable, our team will review and process it within 3-5 business days."
          : "";

        const customerMessage = `Hi ${customerName}, your order #${formatOrderId(orderId)} for ${eventDateStr} has been cancelled.${refundLine} If you have any questions, please contact us. Thank you for choosing Bounce Party Club!`;

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

    const refundMessage = adminOverrideRefund === true
      ? "Refund intent recorded. Please issue the refund manually from the Payments tab."
      : adminOverrideRefund === false
        ? "No refund will be issued per your selection."
        : "Our team will review your cancellation and process any applicable refund within 3-5 business days.";

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your order has been cancelled.",
        refundPolicy: adminOverrideRefund === true ? "refund_requested" : adminOverrideRefund === false ? "no_refund" : "pending_review",
        refundMessage,
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
