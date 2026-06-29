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

function generateWaiverText(businessName: string): string {
  return `LIABILITY WAIVER AND RENTAL AGREEMENT

${businessName}

This Liability Waiver and Rental Agreement ("Agreement") is entered into between ${businessName} ("Company") and the undersigned renter ("Renter"). By signing this Agreement, Renter acknowledges having read, understood, and agreed to all terms.

1. ACKNOWLEDGMENT AND ASSUMPTION OF RISK
Renter acknowledges that the use of inflatable bounce houses, water slides, and related equipment involves inherent risks, including but not limited to physical injury, property damage, or other harm. Renter voluntarily assumes all such risks.

2. WAIVER AND RELEASE OF LIABILITY
Renter hereby releases, waives, discharges, and covenants not to sue ${businessName}, its owners, employees, agents, and representatives from any and all claims, demands, losses, or damages arising from or related to the rental and use of the equipment, including claims arising from negligence.

3. INDEMNIFICATION
Renter agrees to indemnify, defend, and hold harmless ${businessName} from any claims, liabilities, damages, costs, and expenses (including attorney's fees) arising from Renter's use of the equipment or breach of this Agreement.

4. RENTER'S RESPONSIBILITY
Renter is solely responsible for the safe use of all rented equipment and for supervising all users, particularly minors. Renter agrees to maintain adequate adult supervision at all times.

5. EQUIPMENT CONDITION
Renter acknowledges that the equipment was delivered in clean, functional condition and agrees to return it in the same condition, normal wear excepted. Renter assumes responsibility for any damage beyond normal wear.

6. CANCELLATIONS AND REFUNDS
Cancellation policy is subject to ${businessName}'s terms as communicated at time of booking. Deposits may be non-refundable. Renter acknowledges understanding of the applicable cancellation and refund terms.

7. PHOTO AND VIDEO RELEASE (Optional)
Unless Renter objects in writing prior to the event, ${businessName} reserves the right to photograph or video the event for marketing purposes.

8. DAMAGE RESPONSIBILITY AND FEE
Renter accepts full financial responsibility for any damage to the equipment caused by misuse, failure to follow safety rules, or negligence. A damage assessment fee may apply.

9. RULES AND SAFETY COMPLIANCE
Renter agrees to ensure all users comply with safety rules provided by ${businessName}, including weight limits, age restrictions, and prohibited activities. Failure to comply may result in immediate removal of equipment at Renter's expense.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of Michigan. Any disputes shall be resolved in Wayne County, Michigan courts.

11. SEVERABILITY
If any provision of this Agreement is found invalid or unenforceable, the remaining provisions shall remain in full force and effect.

12. ENTIRE AGREEMENT
This Agreement constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, or agreements.

13. MINORS
Renter represents that they are at least 18 years of age and legally capable of entering into this Agreement.

14. INSURANCE DISCLAIMER
${businessName} does not provide insurance coverage for personal injury or property damage. Renter is advised to obtain their own coverage if desired.`;
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
      .select("id, customers(first_name, last_name), addresses(address, city, state), event_date")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: logoSetting } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "logo_url")
      .maybeSingle();
    const logoUrl: string | null = logoSetting?.value || null;

    const { data: businessNameSetting } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "business_name")
      .maybeSingle();
    const businessName: string = businessNameSetting?.value || "Bounce Party Club LLC";

    const waiverText = generateWaiverText(businessName);

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
    doc.text(businessName, pageWidth / 2, y, { align: "center" });
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
      const addrLine = [address.address, address.city, address.state].filter(Boolean).join(", ");
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
