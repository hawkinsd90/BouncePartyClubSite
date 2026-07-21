import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jsPDF } from "npm:jspdf@2.5.2";
import {
  MARGIN,
  INLINE_INITIALS_SECTIONS,
  fetchLogoDataUrl,
  parseWaiverSections,
  renderPageHeader,
  stampAllPageHeaders,
  stampAllPageFooters,
} from "../_shared/waiver-pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

// Order that requires the additional Wayne County / Wayne County Parks section.
const WAYNE_COUNTY_ORDER_ID = "4ae9723c-936f-4155-ad93-2e47ef844feb";

// IMPORTANT: This function must stay in sync with src/lib/waiverContent.ts generateWaiverText().
// The digital signing flow stores a snapshot of that text at signing time. If these diverge,
// the blank waiver shown to customers will not match what they ultimately sign electronically.
// When updating either copy, update BOTH files.
function generateWaiverText(businessName: string, businessLegalEntity: string, businessAddress: string, businessPhone: string, businessEmail: string, orderId: string): string {
  const baseText = `${businessLegalEntity}
${businessAddress} | ${businessPhone} | ${businessEmail}

IMPORTANT: THIS IS A LEGAL DOCUMENT. PLEASE READ CAREFULLY BEFORE SIGNING.

This Waiver and Release of Liability Agreement ("Agreement") is entered into by the undersigned Renter ("Renter") in favor of ${businessLegalEntity}, and its owners, employees, agents, affiliates, and contractors ("${businessName}").

1. ACKNOWLEDGMENT AND ASSUMPTION OF RISK

I understand that the use of inflatable bounce houses and related equipment carries inherent risks of injury or damage. I voluntarily assume all such risks for myself and all participants under my supervision.

I agree to inform all participants of the risks and safety rules and accept responsibility for their compliance during the rental period.

This waiver applies for the entire rental duration, including setup, idle time, and breakdown, regardless of whether the equipment is actively in use.

2. WAIVER AND RELEASE OF LIABILITY

I fully and forever release and discharge ${businessName} from any and all claims or liabilities arising out of injury or damage during the rental period, whether from negligence or otherwise.

This waiver does not apply to claims arising from gross negligence or willful misconduct by ${businessName}.

Gross negligence is defined as conduct so reckless as to demonstrate a substantial lack of concern for whether injury results.

3. INDEMNIFICATION

I agree to indemnify and hold harmless ${businessName} from any claims or liabilities arising out of the use of its equipment.

4. RENTER'S RESPONSIBILITY

I accept full responsibility for supervising all participants using the equipment and for communicating all safety rules.

5. EQUIPMENT CONDITION

I acknowledge that I have inspected the equipment and found it in good working condition at the start of the rental period. I understand I may take photos or videos of any visible damage or concerns before ${businessName} leaves the setup location and agree to share such documentation immediately.

6. CANCELLATIONS AND REFUNDS

I understand and agree that any deposit or initial payment made toward my reservation is refundable only if I cancel seventy-two (72) hours or more before the scheduled event time.

If I cancel less than seventy-two (72) hours before the event, I understand that my deposit or initial payment is non-refundable, but may be applied one (1) time toward a rescheduled date within twelve (12) months, subject to availability and the discretion of ${businessName}.

If ${businessName} determines that weather or safety conditions make delivery or setup unsafe, my reservation will be eligible for one (1) free reschedule within twelve (12) months. No monetary refunds will be issued for weather-related cancellations.

If ${businessName} must cancel my reservation for operational reasons unrelated to weather or safety, I may be offered a refund or a rescheduled date at the sole discretion of ${businessName}.

Once delivery has begun or setup has started at the event location, I understand that no refunds or credits of any kind will be provided.

7. PHOTO AND VIDEO RELEASE (Optional)

I consent to the use of any photos or videos taken during the event for promotional purposes by ${businessName}, unless I notify the company in writing prior to the rental date.

8. DAMAGE RESPONSIBILITY AND FEE

I understand and agree that I am responsible for any intentional, negligent, or reckless damage to ${businessName} equipment.

I may be charged a minimum of $150.00, or more depending on the extent of the damage, subject to ${businessName}'s reasonable assessment and documentation.

I agree to remit payment within 10 business days upon receiving a written notice and invoice.

9. RULES AND SAFETY COMPLIANCE

I agree to follow all instructions and safety rules provided by ${businessName}. I further acknowledge the following safety guidelines apply during the rental period and must be enforced by me as the responsible renter:

• Adult supervision is required at all times.
• No shoes inside the inflatable.
• No sharp objects, including keys, jewelry, or glasses.
• No food, drinks, or gum inside the inflatable.
• No rough play, wrestling, or climbing on the unit.
• Do not hang on netting, walls, or roofs.
• Limit occupancy by age group and size.
• No silly string, face paint, glitter, or confetti.
• Keep the unit dry unless authorized for water use.
• Exit immediately during rain, lightning, or winds over 15 MPH.
• Do not unplug or move blowers or extension cords.
• Do not exceed posted weight or occupancy limits.

In the event of injury or emergency, I agree to call 911 immediately and notify ${businessName} as soon as reasonably possible.

I agree to monitor weather conditions and cease use of the equipment in unsafe weather including, but not limited to, rain, high winds, or lightning.

I acknowledge that I have received and reviewed the safety instructions provided by ${businessName} and had the opportunity to ask questions.

10. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the State of Michigan. Any legal action or proceeding arising out of this Agreement shall be brought exclusively in the courts of Wayne County, Michigan, and the parties hereby consent to the jurisdiction of such courts.

11. SEVERABILITY

If any provision is found invalid, the rest remains enforceable.

12. ENTIRE AGREEMENT

This Agreement reflects the complete understanding between ${businessName} and the Renter.

13. MINORS

If participants under the age of 18 will be present, I acknowledge that I am their parent/legal guardian or have secured the consent of their parent/legal guardian and accept all terms of this Agreement on their behalf.

If I am not the parent or legal guardian of participating minors, I affirm I have obtained written consent from the responsible parties agreeing to the terms of this waiver.

14. INSURANCE DISCLAIMER

${businessName} does not provide medical or liability insurance for injuries sustained while using the equipment.`;

  if (orderId === WAYNE_COUNTY_ORDER_ID) {
    return baseText + `

15. WAYNE COUNTY AND WAYNE COUNTY PARKS — INDEPENDENT PROVIDER

The inflatable equipment is provided, installed, and operated solely by Bounce Party Club LLC and not by Wayne County or Wayne County Parks.

The renter acknowledges that Wayne County and Wayne County Parks are not responsible for the operation, supervision, maintenance, or use of the inflatable equipment.`;
  }

  return baseText;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { orderId, token } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (token) {
      const { data: link } = await supabaseClient
        .from("invoice_links")
        .select("order_id, expires_at")
        .eq("link_token", token)
        .maybeSingle();
      if (link && link.order_id === orderId) {
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
          return new Response(JSON.stringify({ error: "Link expired" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, customers(first_name, last_name), addresses(line1, city, state), event_date")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabaseClient
      .from("admin_settings")
      .select("key, value")
      .in("key", ["logo_url", "business_name", "business_name_short", "business_legal_entity", "business_address", "business_phone", "business_email"]);

    const sm: Record<string, string> = {};
    for (const row of settings ?? []) {
      if (row.key && row.value) sm[row.key] = row.value;
    }

    const logoUrl = sm["logo_url"] || null;
    const businessName = sm["business_name_short"] || sm["business_name"] || "Bounce Party Club";
    const businessLegalEntity = sm["business_legal_entity"] || sm["business_name"] || "Bounce Party Club LLC";
    const businessAddress = sm["business_address"] || "";
    const businessPhone = sm["business_phone"] || "";
    const businessEmail = sm["business_email"] || "";
    const businessInfoLine = [
      businessLegalEntity,
      [businessAddress, businessPhone, businessEmail].filter(Boolean).join(" | "),
    ].filter(Boolean).join("  ");

    const waiverText = generateWaiverText(businessName, businessLegalEntity, businessAddress, businessPhone, businessEmail, orderId);

    const customer = order.customers as any;
    const address = order.addresses as any;
    const lastName = customer?.last_name || "";
    const signerName = [customer?.first_name || "", lastName].filter(Boolean).join(" ") || "Unknown";
    const eventDate = order.event_date || new Date().toISOString().split("T")[0];
    const eventAddressLine = [address?.line1, address?.city, address?.state].filter(Boolean).join(", ");
    const eventDateFormatted = new Date(eventDate + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const safeLastName = lastName.replace(/[^a-zA-Z0-9]/g, "") || "Customer";
    const pdfFilename = `BPC-Liability-Waiver-${safeLastName}-${eventDate}.pdf`;

    // Pre-fetch logo
    const logoResult = logoUrl ? await fetchLogoDataUrl(logoUrl) : null;
    const logoDataUrl = logoResult?.dataUrl ?? null;
    const logoExt: "JPEG" | "PNG" = logoResult?.ext ?? "PNG";

    const blocks = parseWaiverSections(waiverText);

    // PDF setup
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - 2 * MARGIN;
    const contentMaxY = pageHeight - 18;

    // Render page 1 header; record where content starts
    let y = renderPageHeader(doc, MARGIN, logoDataUrl, logoExt, businessInfoLine);
    const contentStartY = y;

    const addPage = () => { doc.addPage(); y = contentStartY; };
    const ensureSpace = (needed: number) => { if (y + needed > contentMaxY) addPage(); };

    // Waiver body
    for (const block of blocks) {
      if (block.header !== null) {
        ensureSpace(10);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        for (const line of doc.splitTextToSize(block.header, maxWidth)) {
          ensureSpace(6);
          doc.text(line, MARGIN, y);
          y += 5;
        }
        y += 2;
      }

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      for (const para of block.paragraphs) {
        const lines = doc.splitTextToSize(para, maxWidth);
        ensureSpace(lines.length * 4.5 + 4);
        for (const line of lines) {
          if (y > contentMaxY) addPage();
          doc.text(line, MARGIN, y);
          y += 4.5;
        }
        y += 3;
      }

      // Blank initials + date field after sections 6, 8, 9
      if (block.sectionNumber !== null && INLINE_INITIALS_SECTIONS.has(block.sectionNumber)) {
        ensureSpace(14);
        y += 2;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Initials:", MARGIN, y);
        doc.setFont("helvetica", "normal");
        doc.line(MARGIN + 22, y + 1, MARGIN + 62, y + 1);
        doc.setFont("helvetica", "bold");
        doc.text("Date:", MARGIN + 70, y);
        doc.setFont("helvetica", "normal");
        doc.line(MARGIN + 82, y + 1, MARGIN + 130, y + 1);
        y += 10;
      }
    }

    // Signature block
    ensureSpace(60);
    y += 4;
    doc.setDrawColor(0, 0, 0);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("SIGNATURE AND ACCEPTANCE", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Full Legal Name:", MARGIN, y);
    if (signerName !== "Unknown") {
      doc.setFont("helvetica", "bold");
      doc.text(signerName, MARGIN + 45, y);
      doc.setFont("helvetica", "normal");
    } else {
      doc.line(MARGIN + 45, y + 1, pageWidth - MARGIN, y + 1);
    }
    y += 10;
    doc.text("Signature:", MARGIN, y);
    doc.line(MARGIN + 30, y + 1, pageWidth - MARGIN - 50, y + 1);
    doc.text("Date:", pageWidth - MARGIN - 45, y);
    doc.line(pageWidth - MARGIN - 30, y + 1, pageWidth - MARGIN, y + 1);

    // Stamp repeating headers on pages 2+ and footers on all pages
    stampAllPageHeaders(doc, contentStartY, logoDataUrl, logoExt, businessInfoLine);

    const footerRight = [
      signerName !== "Unknown" ? `Prepared For: ${signerName}` : "",
      eventAddressLine,
      eventDateFormatted,
    ].filter(Boolean).join("  ·  ");
    stampAllPageFooters(doc, footerRight);

    const pdfBuffer = doc.output("arraybuffer");

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[generate-blank-waiver] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
