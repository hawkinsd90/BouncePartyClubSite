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
    const messageStatus = formData.get("MessageStatus") as string;
    const errorCode = formData.get("ErrorCode") as string;
    const to = formData.get("To") as string;
    const from = formData.get("From") as string;

    console.log("Status callback received:", {
      messageSid,
      messageStatus,
      errorCode,
      to,
      from,
    });

    if (!messageSid || !messageStatus) {
      console.warn("Missing required parameters");
      return new Response(null, { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: updateError } = await supabase
      .from("sms_conversations")
      .update({
        status: messageStatus,
      })
      .eq("twilio_message_sid", messageSid);

    if (updateError) {
      console.error("Error updating SMS status:", updateError);
    } else {
      console.log(`Updated message ${messageSid} to status: ${messageStatus}`);
    }

    if (errorCode) {
      console.error(`SMS Error for ${messageSid}: Error code ${errorCode}`);
    }

    return new Response(null, {
      status: 200,
    });
  } catch (error) {
    console.error("Error processing status callback:", error);
    
    return new Response(null, {
      status: 200,
    });
  }
});