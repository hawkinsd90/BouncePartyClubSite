import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formParams, twilioCandidateUrls, verifyTwilioRequest } from "../_shared/twilio-signature.ts";

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

    // Public endpoint (Twilio cannot send a Supabase JWT): the Twilio signature is the only proof of origin. It is checked before
    // any status is written; the only database read before that is the signing token.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow } = await supabase.from("admin_settings").select("value").eq("key", "twilio_auth_token").maybeSingle();
    const verdict = await verifyTwilioRequest({
      signatureHeader: req.headers.get("X-Twilio-Signature"),
      authToken: tokenRow?.value as string | undefined,
      params: formParams(formData),
      candidateUrls: twilioCandidateUrls({ requestUrl: req.url, supabaseUrl, functionName: "twilio-status-callback", override: Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? undefined }),
    });
    if (!verdict.ok) {
      console.error("[twilio-status-callback] rejected request:", verdict.reason);
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const messageSid = formData.get("MessageSid") as string;
    const messageStatus = formData.get("MessageStatus") as string;
    const errorCode = formData.get("ErrorCode") as string;

    // console.log("Status callback:", { messageSid, messageStatus, errorCode });

    if (!messageSid || !messageStatus) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const { error: updateError } = await supabase
      .from("sms_conversations")
      .update({
        status: messageStatus,
        error_code: errorCode || null,
      })
      .eq("twilio_message_sid", messageSid);

    if (updateError) {
      console.error("Error updating SMS status:", updateError);
      throw updateError;
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing status callback:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
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