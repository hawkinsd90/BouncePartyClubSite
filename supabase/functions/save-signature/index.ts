import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const {
      orderId,
      customerId,
      // Renter information snapshot
      renterName,
      renterPhone,
      renterEmail,
      eventDate,
      eventEndDate,
      eventAddressLine1,
      eventAddressLine2,
      eventCity,
      eventState,
      eventZip,
      homeAddressLine1,
      homeAddressLine2,
      homeCity,
      homeState,
      homeZip,
      // Signature artifacts
      signatureDataUrl,
      initialsData,
      typedName,
      waiverVersion,
      waiverText,
      electronicConsentText,
    } = await req.json();

    if (!orderId || !signatureDataUrl || !renterName || !renterEmail || !renterPhone || !eventDate || !eventAddressLine1 || !eventCity || !eventState || !eventZip) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required renter information or signature fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0] ||
                      req.headers.get("x-real-ip") ||
                      "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    const deviceInfo = {
      userAgent,
      platform: req.headers.get("sec-ch-ua-platform") || "unknown",
      mobile: req.headers.get("sec-ch-ua-mobile") === "?1",
    };

    const base64Data = signatureDataUrl.split(",")[1];
    const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    const fileName = `${orderId}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from("signatures")
      .upload(fileName, binaryData, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to upload signature: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: urlData } = supabaseClient.storage
      .from("signatures")
      .getPublicUrl(uploadData.path);

    const signatureImageUrl = urlData.publicUrl;

    const { data: signatureRecord, error: dbError } = await supabaseClient
      .from("order_signatures")
      .insert({
        order_id: orderId,
        customer_id: customerId,
        // Signer identity (using renter info)
        signer_name: renterName,
        signer_email: renterEmail,
        signer_phone: renterPhone,
        // Renter information snapshot
        event_date: eventDate,
        event_end_date: eventEndDate || null,
        event_address_line1: eventAddressLine1,
        event_address_line2: eventAddressLine2 || '',
        event_city: eventCity,
        event_state: eventState,
        event_zip: eventZip,
        home_address_line1: homeAddressLine1 || '',
        home_address_line2: homeAddressLine2 || '',
        home_city: homeCity || '',
        home_state: homeState || '',
        home_zip: homeZip || '',
        // Signature artifacts
        signature_image_url: signatureImageUrl,
        initials_data: initialsData,
        typed_name: typedName,
        // Compliance metadata
        ip_address: ipAddress,
        user_agent: userAgent,
        device_info: deviceInfo,
        waiver_version: waiverVersion,
        waiver_text_snapshot: waiverText,
        electronic_consent_given: true,
        electronic_consent_text: electronicConsentText,
        signed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database error:", dbError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to save signature: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: orderUpdateError } = await supabaseClient
      .from("orders")
      .update({
        waiver_signed_at: new Date().toISOString(),
        signature_id: signatureRecord.id,
        e_signature_consent: true,
      })
      .eq("id", orderId);

    if (orderUpdateError) {
      console.error("Order update error:", orderUpdateError);
    }

    const { error: consentError } = await supabaseClient
      .from("consent_records")
      .insert({
        order_id: orderId,
        customer_id: customerId,
        consent_type: "electronic_signature",
        consented: true,
        consent_text: electronicConsentText,
        consent_version: waiverVersion,
        consented_at: new Date().toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
      });

    if (consentError) {
      console.error("Consent record error:", consentError);
    }

    (async () => {
      try {
        const pdfResponse = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-signed-waiver`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ signatureId: signatureRecord.id }),
          }
        );

        if (!pdfResponse.ok) {
          console.error("PDF generation failed:", await pdfResponse.text());
        }
      } catch (pdfError) {
        console.error("PDF generation error:", pdfError);
      }
    })();

    return new Response(
      JSON.stringify({
        success: true,
        signatureId: signatureRecord.id,
        message: "Signature saved successfully. PDF generation in progress.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("save-signature error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
