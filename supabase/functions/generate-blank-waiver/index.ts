import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jsPDF } from "npm:jspdf@2.5.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INITIALS_REQUIRED = [
  "Cancellations and Refunds",
  "Damage Responsibility and Fee",
  "Rules and Safety Compliance",
];

const WAIVER_VERSION = "1.0";

// IMPORTANT: This function must stay in sync with src/lib/waiverContent.ts generateWaiverText().
// The digital signing flow stores a snapshot of that text at signing time. If these diverge,
// the blank waiver shown to customers will not match what they ultimately sign electronically.
// When updating either copy, update BOTH files.
function generateWaiverText(businessName: string, businessLegalEntity: string, businessAddress: string, businessPhone: string, businessEmail: string): string {
  return `${businessLegalEntity}
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

    // If token provided, validate it against invoice_links
    if (token) {
      const { data: link } = await supabaseClient
        .from("invoice_links")
        .select("order_id, expires_at")
        .eq("link_token", token)
        .maybeSingle();

      if (!link || link.order_id !== orderId) {
        // Token mismatch — fall through to orderId-only check (same as get-waiver-status)
      } else if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Link expired" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Verify order exists (same gate as get-waiver-status)
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

    const settingsMap: Record<string, string> = {};
    for (const row of settings ?? []) {
      if (row.key && row.value) settingsMap[row.key] = row.value;
    }

    const logoUrl: string | null = settingsMap["logo_url"] || null;
    const businessName: string = settingsMap["business_name_short"] || settingsMap["business_name"] || "Bounce Party Club";
    const businessLegalEntity: string = settingsMap["business_legal_entity"] || settingsMap["business_name"] || "Bounce Party Club LLC";
    const businessAddress: string = settingsMap["business_address"] || "";
    const businessPhone: string = settingsMap["business_phone"] || "";
    const businessEmail: string = settingsMap["business_email"] || "";

    const waiverText = generateWaiverText(businessName, businessLegalEntity, businessAddress, businessPhone, businessEmail);

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let y = margin;

    // Logo
    if (logoUrl) {
      try {
        const logoResponse = await fetch(logoUrl);
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.arrayBuffer();
          const base64Logo = btoa(String.fromCharCode(...new Uint8Array(logoBlob)));
          const contentType = logoResponse.headers.get("content-type") || "image/png";
          const ext = contentType.includes("jpeg") ? "JPEG" : "PNG";
          const logoDataUrl = `data:${contentType};base64,${base64Logo}`;
          const logoWidth = 40;
          const logoHeight = 20;
          doc.addImage(logoDataUrl, ext, (pageWidth - logoWidth) / 2, y, logoWidth, logoHeight);
          y += logoHeight + 6;
        }
      } catch { /* continue without logo */ }
    }

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("LIABILITY WAIVER AND RENTAL AGREEMENT", pageWidth / 2, y, { align: "center" });
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(businessLegalEntity, pageWidth / 2, y, { align: "center" });
    y += 5;
    doc.text(`Version ${WAIVER_VERSION} — BLANK COPY FOR PHYSICAL SIGNATURE`, pageWidth / 2, y, { align: "center" });
    y += 5;

    // Pre-filled customer info
    const customer = order.customers as any;
    const address = order.addresses as any;
    if (customer) {
      const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
      if (name) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(60, 100, 180);
        doc.text(`Prepared for: ${name}`, pageWidth / 2, y, { align: "center" });
        y += 4;
      }
    }
    if (address) {
      const addrLine = [address.line1, address.city, address.state].filter(Boolean).join(", ");
      if (addrLine) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(60, 100, 180);
        doc.text(`Event address: ${addrLine}`, pageWidth / 2, y, { align: "center" });
        y += 4;
      }
    }
    if (order.event_date) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(60, 100, 180);
      doc.text(`Event date: ${new Date(order.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`, pageWidth / 2, y, { align: "center" });
      y += 4;
    }
    doc.setTextColor(0, 0, 0);

    y += 3;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Waiver body text
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(waiverText, maxWidth);
    for (const line of lines) {
      if (y > pageHeight - 30) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += 5;
    }

    // Ensure enough space for signature section
    if (y > pageHeight - 100) { doc.addPage(); y = margin; }

    y += 10;
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("INITIALS REQUIRED — SIGN EACH SECTION BELOW", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    for (const section of INITIALS_REQUIRED) {
      if (y > pageHeight - 30) { doc.addPage(); y = margin; }
      doc.text(`${section}:`, margin, y);
      doc.line(margin + 80, y + 1, margin + 130, y + 1);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(120, 120, 120);
      doc.text("Initial here", margin + 82, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      y += 10;
    }

    y += 5;
    if (y > pageHeight - 60) { doc.addPage(); y = margin; }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("SIGNATURE AND ACCEPTANCE", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    // Pre-fill name if available
    const signerName = customer
      ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
      : "";
    doc.text("Full Legal Name:", margin, y);
    if (signerName) {
      doc.setFont("helvetica", "bold");
      doc.text(signerName, margin + 45, y);
      doc.setFont("helvetica", "normal");
    } else {
      doc.line(margin + 45, y + 1, pageWidth - margin, y + 1);
    }
    y += 10;

    doc.text("Signature:", margin, y);
    doc.line(margin + 30, y + 1, pageWidth - margin - 50, y + 1);
    doc.text("Date:", pageWidth - margin - 45, y);
    doc.line(pageWidth - margin - 30, y + 1, pageWidth - margin, y + 1);
    y += 14;

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text(
      "By signing, you agree to the terms of this Agreement. Return the signed copy to your delivery crew.",
      pageWidth / 2,
      pageHeight - 20,
      { align: "center" }
    );
    doc.text(
      "This is a paper copy. Digital signing is available at the Customer Portal.",
      pageWidth / 2,
      pageHeight - 15,
      { align: "center" }
    );

    const pdfBuffer = doc.output("arraybuffer");
    const pdfBytes = new Uint8Array(pdfBuffer);

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waiver-blank-${orderId.slice(0, 8)}.pdf"`,
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
