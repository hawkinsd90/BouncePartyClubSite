import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const formData = await req.formData();
    
    const messageSid = formData.get("MessageSid") as string;
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;
    const body = formData.get("Body") as string;
    const messageStatus = formData.get("SmsStatus") as string;

    console.log("Received SMS:", { messageSid, from, to, body });

    if (!messageSid || !from || !to || !body) {
      return new Response(
        JSON.stringify({ error: "Missing required Twilio parameters" }),
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

    const normalizePhone = (phone: string) => {
      return phone.replace(/[^0-9]/g, "").slice(-10);
    };

    const normalizedFrom = normalizePhone(from);
    
    const { data: customers } = await supabase
      .from("customers")
      .select("id, phone")
      .ilike("phone", `%${normalizedFrom}%`)
      .limit(1);

    let orderId = null;
    
    if (customers && customers.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id")
        .eq("customer_id", customers[0].id)
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (orders && orders.length > 0) {
        orderId = orders[0].id;
      }
    }

    const { error: insertError } = await supabase
      .from("sms_conversations")
      .insert({
        order_id: orderId,
        from_phone: from,
        to_phone: to,
        message_body: body,
        direction: "inbound",
        twilio_message_sid: messageSid,
        status: messageStatus || "received",
      });

    if (insertError) {
      console.error("Error storing SMS:", insertError);
      throw insertError;
    }

    const autoReply = "Thank you for your message! We've received it and will respond shortly. - Bounce Party Club";

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${autoReply}</Message>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: {
        "Content-Type": "text/xml",
      },
    });
  } catch (error) {
    console.error("Error processing webhook:", error);
    
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );
  }
});