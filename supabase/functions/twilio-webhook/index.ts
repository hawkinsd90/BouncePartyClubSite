import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formParams, twilioCandidateUrls, verifyTwilioRequest } from "../_shared/twilio-signature.ts";
import { AUTO_REPLY, HELP_REPLY, classifyInbound, digits10, phoneLikePattern, samePhone, twiml } from "../_shared/sms/inbound.ts";

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

  if (req.method === "GET") {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Webhook is active</Message></Response>',
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );
  }

  try {
    const formData = await req.formData();

    // Public endpoint (Twilio cannot send a Supabase JWT): the Twilio signature is the only proof of origin. It is checked
    // before anything is read from or written to the database other than the signing token itself.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow } = await supabase.from("admin_settings").select("value").eq("key", "twilio_auth_token").maybeSingle();
    const verdict = await verifyTwilioRequest({
      signatureHeader: req.headers.get("X-Twilio-Signature"),
      authToken: tokenRow?.value as string | undefined,
      params: formParams(formData),
      candidateUrls: twilioCandidateUrls({ requestUrl: req.url, supabaseUrl, functionName: "twilio-webhook", override: Deno.env.get("TWILIO_WEBHOOK_URL") ?? undefined }),
    });
    if (!verdict.ok) {
      console.error("[twilio-webhook] rejected request:", verdict.reason);
      return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain" } });
    }

    const messageSid = formData.get("MessageSid") as string;
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;
    const body = formData.get("Body") as string;
    const messageStatus = formData.get("SmsStatus") as string;

    // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
    // Restore only after a true dev/staging environment and explicit safe gating are in place.
    // Previously logged PII (phone numbers), raw SMS body, and Twilio MessageSid (SM_xxx) — a third-party identifier.
    // console.log("Received SMS:", { messageSid, from, to, body });
    // console.log("Received SMS:", { hasMessageSid: !!messageSid, hasFrom: !!from, hasTo: !!to, hasBody: !!body });

    if (!messageSid || !from || !to || !body) {
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

    const from10 = digits10(from);
    const to10 = digits10(to);
    const xml = (message?: string) => new Response(twiml(message), { status: 200, headers: { "Content-Type": "text/xml" } });
    if (!from10) return xml();

    // Twilio redelivers a message it did not get an answer for: the same MessageSid is processed once.
    const { data: already } = await supabase.from("sms_conversations").select("id").eq("twilio_message_sid", messageSid).limit(1);
    if (already && already.length > 0) return xml();

    // Numbers are stored as typed ("(313) 889-3860"), so match on the digits: a pattern finds the candidates, the digits confirm them.
    let orderId: string | null = null;
    let customerIds: string[] = [];

    const { data: customerRows } = await supabase
      .from("customers")
      .select("id, phone")
      .ilike("phone", phoneLikePattern(from10));
    customerIds = ((customerRows ?? []) as Array<{ id: string; phone: string }>).filter((c) => samePhone(c.phone, from)).map((c) => c.id);

    if (to10) {
      const { data: recentOutbound } = await supabase
        .from("sms_conversations")
        .select("order_id, from_phone, to_phone")
        .eq("direction", "outbound")
        .ilike("from_phone", phoneLikePattern(to10))
        .ilike("to_phone", phoneLikePattern(from10))
        .order("created_at", { ascending: false })
        .limit(10);
      const match = ((recentOutbound ?? []) as Array<{ order_id: string | null; from_phone: string; to_phone: string }>)
        .find((r) => r.order_id && samePhone(r.from_phone, to) && samePhone(r.to_phone, from));
      if (match) orderId = match.order_id;
    }

    if (!orderId && customerIds.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id")
        .in("customer_id", customerIds)
        .in("status", ["pending_review", "confirmed", "draft"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (orders && orders.length > 0) orderId = orders[0].id;
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
      // 23505: a concurrent delivery of the same message already stored it.
      if ((insertError as { code?: string }).code === "23505") return xml();
      console.error("Error storing SMS:", insertError);
      throw insertError;
    }

    const kind = classifyInbound(body);

    if (kind === "stop") {
      // The customer withdrew SMS consent: record it on their orders so nothing is texted to them from here on. Twilio sends the
      // carrier-required confirmation itself, so no reply is added.
      if (customerIds.length > 0) {
        const { error: consentError } = await supabase.from("orders").update({ sms_consent: false }).in("customer_id", customerIds);
        if (consentError) console.error("Error recording SMS opt-out:", consentError);
      }
      return xml();
    }
    if (kind === "start") return xml();
    if (kind === "help") return xml(HELP_REPLY);

    // The reply travels in this response and Twilio records it under its own SID. No outbound row is written here (it used to be written
    // with no SID, so the conversation showed messages Twilio never reported).
    return xml(AUTO_REPLY);
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
