import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmsRequest {
  to?: string;
  message?: string;
  orderId?: string;
  templateKey?: string;
  mediaUrls?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const requestBody: SmsRequest = await req.json();
    console.log("[send-sms-notification] Request:", { ...requestBody, message: requestBody.message ? '[redacted]' : undefined });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let toPhone = requestBody.to;
    let messageBody = requestBody.message;
    const orderId = requestBody.orderId;
    const templateKey = requestBody.templateKey;

    if (templateKey && orderId) {
      console.log("[send-sms-notification] Looking up template:", templateKey);
      
      const { data: template } = await supabase
        .from("sms_message_templates")
        .select("message_template")
        .eq("template_key", templateKey)
        .maybeSingle();

      if (!template) {
        console.error("[send-sms-notification] Template not found:", templateKey);
        throw new Error(`Template '${templateKey}' not found`);
      }

      const { data: order } = await supabase
        .from("orders")
        .select("*, customers(*)")
        .eq("id", orderId)
        .maybeSingle();

      if (!order) {
        console.error("[send-sms-notification] Order not found:", orderId);
        throw new Error(`Order '${orderId}' not found`);
      }

      if (templateKey === "booking_received_admin") {
        const { data: adminPhoneSetting } = await supabase
          .from("admin_settings")
          .select("value")
          .eq("key", "admin_phone")
          .maybeSingle();

        if (!adminPhoneSetting?.value) {
          console.error("[send-sms-notification] Admin phone not configured");
          throw new Error("Admin phone not configured. Please add it in Admin Settings.");
        }

        toPhone = adminPhoneSetting.value;
      } else {
        toPhone = order.customers?.phone;
      }

      messageBody = template.message_template
        .replace("{customer_name}", `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`)
        .replace("{order_id}", order.id.slice(0, 8).toUpperCase())
        .replace("{event_date}", order.event_date || '')
        .replace("{event_address}", order.event_address_line1 || '');
    }

    if (!toPhone || !messageBody) {
      console.error("[send-sms-notification] Missing required fields:", { toPhone: !!toPhone, messageBody: !!messageBody });
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'message' parameter" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (toPhone && !toPhone.startsWith('+')) {
      toPhone = '+1' + toPhone.replace(/\D/g, '');
      console.log("[send-sms-notification] Added country code to phone:", toPhone);
    }

    console.log("[send-sms-notification] Sending to:", toPhone);

    const { data: settings } = await supabase
      .from("admin_settings")
      .select("key, value")
      .in("key", ["twilio_account_sid", "twilio_auth_token", "twilio_from_number"]);

    if (!settings || settings.length !== 3) {
      console.warn("[send-sms-notification] Twilio credentials not configured");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Twilio not configured. Please add credentials in Admin > Settings.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const twilioConfig: any = {};
    settings.forEach((s: any) => {
      if (s.key === "twilio_account_sid") twilioConfig.accountSid = s.value?.trim();
      if (s.key === "twilio_auth_token") twilioConfig.authToken = s.value?.trim();
      if (s.key === "twilio_from_number") twilioConfig.fromNumber = s.value?.trim();
    });

    if (!twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.fromNumber) {
      console.error("[send-sms-notification] Incomplete Twilio config");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Incomplete Twilio configuration. Please check Admin > Settings.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const auth = btoa(`${twilioConfig.accountSid}:${twilioConfig.authToken}`);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Messages.json`;

    const formData = new URLSearchParams();
    formData.append("To", toPhone);
    formData.append("From", twilioConfig.fromNumber);
    formData.append("Body", messageBody);

    if (requestBody.mediaUrls && requestBody.mediaUrls.length > 0) {
      requestBody.mediaUrls.forEach((url) => {
        formData.append("MediaUrl", url);
      });
      console.log("[send-sms-notification] Attaching", requestBody.mediaUrls.length, "media files");
    }

    console.log("[send-sms-notification] Calling Twilio API");
    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!twilioResponse.ok) {
      const errorData = await twilioResponse.json();
      console.error("[send-sms-notification] Twilio error response:", {
        status: twilioResponse.status,
        code: errorData.code,
        message: errorData.message,
        moreInfo: errorData.more_info
      });
      throw new Error(`Twilio API error (${errorData.code}): ${errorData.message || 'Unknown error'}`);
    }

    const data = await twilioResponse.json();
    console.log("[send-sms-notification] Twilio response:", { sid: data.sid, status: data.status });

    await supabase.from("sms_conversations").insert({
      order_id: orderId || null,
      from_phone: twilioConfig.fromNumber,
      to_phone: toPhone,
      message_body: messageBody,
      direction: "outbound",
      twilio_message_sid: data.sid,
      status: data.status,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageSid: data.sid,
        status: data.status,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("[send-sms-notification] Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send SMS",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});