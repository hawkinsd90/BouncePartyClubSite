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
    // Parse incoming Twilio status callback data (application/x-www-form-urlencoded)
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

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update SMS conversation status in database
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

    // If there's an error code, log it for debugging
    if (errorCode) {
      console.error(`SMS Error for ${messageSid}: Error code ${errorCode}`);
    }

    // Return success (empty response)
    return new Response(null, {
      status: 200,
    });
  } catch (error) {
    console.error("Error processing status callback:", error);
    
    // Return success even on error so Twilio doesn't retry
    return new Response(null, {
      status: 200,
    });
  }
});