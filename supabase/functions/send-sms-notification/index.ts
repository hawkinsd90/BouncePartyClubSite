import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmsRequest {
  to: string;
  message: string;
  orderId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { to, message, orderId }: SmsRequest = await req.json();

    if (!to || !message) {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: settings } = await supabase
      .from("admin_settings")
      .select("key, value")
      .in("key", ["twilio_account_sid", "twilio_auth_token", "twilio_from_number"]);

    if (!settings || settings.length !== 3) {
      console.warn("Twilio credentials not configured in database. SMS sending disabled.");
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
      if (s.key === "twilio_account_sid") twilioConfig.accountSid = s.value;
      if (s.key === "twilio_auth_token") twilioConfig.authToken = s.value;
      if (s.key === "twilio_from_number") twilioConfig.fromNumber = s.value;
    });

    if (!twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.fromNumber) {
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
    formData.append("To", to);
    formData.append("From", twilioConfig.fromNumber);
    formData.append("Body", message);

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
      console.error("Twilio error:", errorData);
      throw new Error(`Twilio API error: ${errorData.message || 'Unknown error'}`);
    }

    const data = await twilioResponse.json();

    await supabase.from("sms_conversations").insert({
      order_id: orderId || null,
      from_phone: twilioConfig.fromNumber,
      to_phone: to,
      message_body: message,
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
    console.error("Error sending SMS:", error);
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