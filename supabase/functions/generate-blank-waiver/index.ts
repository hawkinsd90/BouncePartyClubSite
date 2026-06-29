import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jsPDF } from "npm:jspdf@2.5.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

// Sections that require an inline initials + date field after their body text
const INLINE_INITIALS_SECTIONS = new Set([6, 8, 9]);

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

    const customer = order.customers as any;
    const address = order.addresses as any;

    const firstName: string = customer?.first_name || "";
    const lastName: string = customer?.last_name || "";
    const signerName: string = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
    const eventDate: string = order.event_date || new Date().toISOString().split("T")[0];
    const eventAddressLine: string = [address?.line1, address?.city, address?.state].filter(Boolean).join(", ");
    const eventDateFormatted: string = new Date(eventDate + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const safeLastName = lastName.replace(/[^a-zA-Z0-9]/g, "") || "Customer";
    const pdfFilename = `BPC-Liability-Waiver-${safeLastName}-${eventDate}.pdf`;

    // Pre-fetch logo so it can be reused on every page header
    let logoDataUrl: string | null = null;
    let logoExt: "JPEG" | "PNG" = "PNG";
    const LOGO_W = 36;
    const LOGO_H = 18;

    if (logoUrl) {
      try {
        const logoResponse = await fetch(logoUrl);
        if (logoResponse.ok) {
          const logoBlob = await logoResponse.arrayBuffer();
          const base64Logo = btoa(String.fromCharCode(...new Uint8Array(logoBlob)));
          const contentType = logoResponse.headers.get("content-type") || "image/png";
          logoExt = contentType.includes("jpeg") ? "JPEG" : "PNG";
          logoDataUrl = `data:${contentType};base64,${base64Logo}`;
        }
      } catch { /* continue without logo */ }
    }

    // PDF setup
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    const footerHeight = 12; // reserved at bottom for footer

    // ── HEADER RENDERING ───────────────────────────────────────────────────────
    // Returns the y position after the header separator line (= content start y)
    const renderPageHeader = (startY: number): number => {
      let y = startY;

      // Title
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("LIABILITY WAIVER AND RENTAL AGREEMENT", pageWidth / 2, y, { align: "center" });
      y += 8;

      // Logo (centered, between title and business info)
      if (logoDataUrl) {
        doc.addImage(logoDataUrl, logoExt, (pageWidth - LOGO_W) / 2, y, LOGO_W, LOGO_H);
        y += LOGO_H + 4;
      }

      // Business info line
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      const businessInfoLine = [
        businessLegalEntity,
        [businessAddress, businessPhone, businessEmail].filter(Boolean).join(" | "),
      ].filter(Boolean).join("  ");
      doc.text(businessInfoLine, pageWidth / 2, y, { align: "center" });
      y += 5;

      // Separator
      y += 2;
      doc.setDrawColor(180, 180, 180);
      doc.line(margin, y, pageWidth - margin, y);
      y += 7;

      return y;
    };

    // Render header on page 1 and record the content start Y
    let y = renderPageHeader(margin);
    const contentStartY = y; // reused for pages 2+

    const contentMaxY = pageHeight - footerHeight;

    const addPage = () => {
      doc.addPage();
      // Reserve space for the header which will be stamped in the post-render loop
      y = contentStartY;
    };

    const ensureSpace = (needed: number) => {
      if (y + needed > contentMaxY) addPage();
    };

    // ── PARSE WAIVER TEXT INTO SECTIONS ────────────────────────────────────────
    const paragraphs = waiverText.split("\n\n");
    // Skip first two paragraphs: business info line and "IMPORTANT" intro — both in header
    const bodyParagraphs = paragraphs.slice(2);

    interface WaiverSection {
      sectionNumber: number;
      header: string;
      paragraphs: string[];
    }
    interface IntroBlock {
      sectionNumber: null;
      header: null;
      paragraphs: string[];
    }
    type Block = WaiverSection | IntroBlock;

    const blocks: Block[] = [];
    let currentBlock: Block = { sectionNumber: null, header: null, paragraphs: [] };

    for (const para of bodyParagraphs) {
      const headerMatch = para.match(/^(\d+)\. /);
      if (headerMatch) {
        if (currentBlock.paragraphs.length > 0 || currentBlock.header !== null) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          sectionNumber: parseInt(headerMatch[1]),
          header: para,
          paragraphs: [],
        };
      } else {
        currentBlock.paragraphs.push(para);
      }
    }
    if (currentBlock.paragraphs.length > 0 || currentBlock.header !== null) {
      blocks.push(currentBlock);
    }

    // ── WAIVER BODY ────────────────────────────────────────────────────────────
    for (const block of blocks) {
      if (block.header !== null) {
        ensureSpace(10);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        const headerLines = doc.splitTextToSize(block.header, maxWidth);
        for (const line of headerLines) {
          ensureSpace(6);
          doc.text(line, margin, y);
          y += 5;
        }
        y += 2;
      }

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");

      for (const para of (block as WaiverSection).paragraphs) {
        const lines = doc.splitTextToSize(para, maxWidth);
        ensureSpace(lines.length * 4.5 + 4);
        for (const line of lines) {
          if (y > contentMaxY) addPage();
          doc.text(line, margin, y);
          y += 4.5;
        }
        y += 3;
      }

      // Inline initials field after sections 6, 8, 9
      if (block.sectionNumber !== null && INLINE_INITIALS_SECTIONS.has(block.sectionNumber)) {
        ensureSpace(14);
        y += 2;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Initials:", margin, y);
        doc.setFont("helvetica", "normal");
        doc.line(margin + 22, y + 1, margin + 62, y + 1);
        doc.setFont("helvetica", "bold");
        doc.text("Date:", margin + 70, y);
        doc.setFont("helvetica", "normal");
        doc.line(margin + 82, y + 1, margin + 130, y + 1);
        y += 10;
      }
    }

    // ── SIGNATURE BLOCK ────────────────────────────────────────────────────────
    ensureSpace(60);
    y += 4;
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("SIGNATURE AND ACCEPTANCE", pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Full Legal Name:", margin, y);
    if (signerName && signerName !== "Unknown") {
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

    // ── PER-PAGE HEADERS (pages 2+) AND FOOTERS (all pages) ───────────────────
    const totalPages = (doc.internal as any).getNumberOfPages();
    const footerY = pageHeight - 5;
    const footerPreparedFor = signerName && signerName !== "Unknown" ? `Prepared For: ${signerName}` : "";
    const footerEvent = [eventAddressLine, eventDateFormatted].filter(Boolean).join(" · ");

    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);

      // Stamp header on pages 2+ (page 1 already has it from initial render)
      if (p > 1) {
        renderPageHeader(margin);
      }

      // Footer separator + content
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${p} / ${totalPages}`, margin, footerY);
      const footerRight = [footerPreparedFor, footerEvent].filter(Boolean).join("  ·  ");
      if (footerRight) {
        doc.text(footerRight, pageWidth - margin, footerY, { align: "right" });
      }
      doc.setTextColor(0, 0, 0);
    }

    const pdfBuffer = doc.output("arraybuffer");
    const pdfBytes = new Uint8Array(pdfBuffer);

    return new Response(pdfBytes, {
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
