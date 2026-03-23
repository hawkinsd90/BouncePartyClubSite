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
        const firstName = renterName.split(" ")[0] || renterName;
        const formattedDate = new Date(eventDate).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const eventAddress = [eventAddressLine1, eventAddressLine2, `${eventCity}, ${eventState} ${eventZip}`]
          .filter(Boolean)
          .join(", ");
        const signedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

        // Generate the signed waiver PDF so we can attach it to the confirmation email
        // and store a permanent public link for the customer portal.
        let pdfUrl: string | null = null;
        let pdfBase64: string | null = null;
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

          if (pdfResponse.ok) {
            const pdfData = await pdfResponse.json();
            pdfUrl = pdfData.pdfUrl || null;

            // Fetch the PDF bytes so we can attach the file directly to the email.
            // This gives customers an immediately openable attachment rather than
            // requiring them to click a link.
            if (pdfUrl) {
              try {
                const pdfBytesResponse = await fetch(pdfUrl);
                if (pdfBytesResponse.ok) {
                  const buffer = await pdfBytesResponse.arrayBuffer();
                  pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                }
              } catch (fetchErr) {
                console.error("PDF bytes fetch failed (attachment will be omitted):", fetchErr);
              }
            }
          } else {
            console.error("PDF generation failed:", await pdfResponse.text());
          }
        } catch (pdfError) {
          console.error("PDF generation error:", pdfError);
        }

        // Always include the download link in the body. When the attachment is also
        // present it acts as a convenient fallback for email clients that strip attachments.
        const pdfSection = pdfUrl
          ? `
            <div style="background-color:#f0fdf4;border:2px solid #10b981;border-radius:6px;padding:18px;margin:25px 0;text-align:center;">
              <h3 style="margin:0 0 10px;color:#15803d;font-size:15px;font-weight:600;">Your Signed Waiver Copy</h3>
              <p style="margin:0 0 14px;color:#166534;font-size:14px;">Your signed rental agreement is attached to this email. You can also download it using the button below.</p>
              <a href="${pdfUrl}" target="_blank" style="display:inline-block;background-color:#10b981;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:15px;">Download Signed Waiver (PDF)</a>
              <p style="margin:12px 0 0;color:#64748b;font-size:12px;">Keep this for your records. This link will remain active.</p>
            </div>`
          : `
            <div style="background-color:#fef3c7;border:2px solid #f59e0b;border-radius:6px;padding:14px;margin:25px 0;">
              <p style="margin:0;color:#92400e;font-size:13px;">Your signed waiver PDF is being generated and will be available in your customer portal shortly.</p>
            </div>`;

        const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);border:2px solid #10b981;">
        <tr>
          <td style="background-color:#ffffff;padding:30px;text-align:center;border-bottom:2px solid #10b981;">
            <img src="https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png" alt="Bounce Party Club" style="height:80px;width:auto;" />
            <h1 style="margin:15px 0 0;color:#10b981;font-size:24px;font-weight:bold;">Rental Agreement Signed</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:30px;">
            <p style="margin:0 0 20px;color:#1e293b;font-size:16px;">Hi ${firstName},</p>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Thank you for signing your rental agreement. Your electronic signature has been recorded and this confirms your agreement to the rental terms.</p>
            <div style="background-color:#f0fdf4;border:2px solid #10b981;border-radius:6px;padding:20px;margin:25px 0;">
              <h3 style="margin:0 0 15px;color:#15803d;font-size:16px;font-weight:600;">Signature Details</h3>
              <table width="100%" cellpadding="6" cellspacing="0">
                <tr>
                  <td style="color:#64748b;font-size:14px;">Signed By:</td>
                  <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${renterName}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:14px;">Event Date:</td>
                  <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${formattedDate}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:14px;">Event Address:</td>
                  <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${eventAddress}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:14px;">Signed At:</td>
                  <td style="color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${signedAt}</td>
                </tr>
              </table>
            </div>
            ${pdfSection}
            <div style="background-color:#dbeafe;border:2px solid #3b82f6;border-radius:6px;padding:18px;margin:25px 0;">
              <h3 style="margin:0 0 12px;color:#1e40af;font-size:15px;font-weight:600;">Important Reminders</h3>
              <ul style="margin:0;padding-left:20px;color:#1e40af;font-size:14px;line-height:1.8;">
                <li>No shoes on inflatables</li>
                <li>No food or drinks on equipment</li>
                <li>No sharp objects</li>
                <li>No hanging or climbing on the nets</li>
                <li>Adult supervision required at all times</li>
              </ul>
            </div>
            <p style="margin:25px 0 0;color:#475569;font-size:14px;line-height:1.6;">Questions? Call us at <strong style="color:#1e293b;">(313) 889-3860</strong></p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8fafc;padding:25px;text-align:center;border-top:2px solid #10b981;">
            <p style="margin:0;color:#64748b;font-size:13px;">Bounce Party Club | (313) 889-3860</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const emailBody: Record<string, unknown> = {
          to: renterEmail,
          subject: "Your Rental Agreement Has Been Signed — Bounce Party Club",
          html: emailHtml,
        };

        // Attach the PDF directly when bytes are available. Resend accepts
        // attachments as { filename, content } where content is base64.
        if (pdfBase64) {
          emailBody.attachments = [
            {
              filename: `signed-waiver-${orderId}.pdf`,
              content: pdfBase64,
            },
          ];
        }

        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailBody),
        });
      } catch (emailError) {
        console.error("Waiver confirmation email error:", emailError);
      }
    })();

    return new Response(
      JSON.stringify({
        success: true,
        signatureId: signatureRecord.id,
        message: "Signature saved successfully. A signed copy will be emailed to you shortly.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("save-signature error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
