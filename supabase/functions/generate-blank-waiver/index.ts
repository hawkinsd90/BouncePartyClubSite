import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// pdfkit expects Node's Buffer global, which isn't defined in the Deno edge
// runtime. Polyfill it from node:buffer BEFORE dynamically importing pdfkit
// so the module sees Buffer at load time.
import { Buffer } from "node:buffer";
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
const { default: PDFDocument } = await import("npm:pdfkit");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WAYNE_COUNTY_ORDER_ID = "4ae9723c-936f-4155-ad93-2e47ef844feb";

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function dateTag(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let orderId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      orderId = url.searchParams.get("orderId") || url.searchParams.get("order_id");
    } else {
      const body = await req.json().catch(() => ({}));
      orderId = body.orderId || body.order_id;
    }

    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id, event_date,
        customers(first_name, last_name, email, phone),
        addresses(line1, city, state, zip)
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customer = order.customers as { first_name: string; last_name: string; email?: string; phone?: string } | null;
    const address = order.addresses as { line1: string; city: string; state: string; zip: string } | null;

    const fullName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ");
    const lastName = customer?.last_name ?? "Customer";
    const addressLine = address
      ? `${address.line1}, ${address.city}, ${address.state} ${address.zip}`
      : "";
    const eventDateFormatted = order.event_date ? formatEventDate(order.event_date) : "";
    const fileDateTag = order.event_date ? dateTag(order.event_date) : "unknown";
    const filename = `BPC-Liability-Waiver-${lastName}-${fileDateTag}.pdf`;

    const isWayneCounty = orderId === WAYNE_COUNTY_ORDER_ID;

    const businessName = "Bounce Party Club";
    const businessLegal = "Bounce Party Club LLC";
    const businessPhone = "(313) 889-3860";
    const businessEmail = "BouncePartyClub@gmail.com";

    // --- Build PDF ---
    const chunks: Buffer[] = [];
    let pageCount = 0;

    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 55, bottom: 65, left: 55, right: 55 },
      bufferPages: false,
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    const addFooter = () => {
      const bottom = doc.page.height - 40;
      const left = 55;
      const right = doc.page.width - 55;
      doc.save();
      doc.font("Helvetica").fontSize(8).fillColor("#666666");
      const footerLeft = `Page ${pageCount}`;
      const footerRight = [
        fullName ? `Prepared For: ${fullName}` : null,
        addressLine || null,
        eventDateFormatted || null,
      ]
        .filter(Boolean)
        .join(" · ");
      doc.text(footerLeft, left, bottom, { align: "left", lineBreak: false });
      if (footerRight) {
        doc.text(footerRight, left, bottom, { align: "right", width: right - left, lineBreak: false });
      }
      doc.restore();
    };

    doc.on("pageAdded", () => {
      pageCount++;
    });

    // Trigger page 1
    pageCount = 1;

    const W = doc.page.width - 110; // text width

    const title = (text: string) => {
      doc.moveDown(0.7);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text(text, { width: W });
      doc.font("Helvetica").fontSize(9.5).fillColor("#000000");
    };

    const para = (text: string) => {
      doc.moveDown(0.35);
      doc.font("Helvetica").fontSize(9.5).fillColor("#000000").text(text, { width: W, align: "justify" });
    };

    const bullet = (text: string) => {
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(9.5).fillColor("#000000").text(`\u2022  ${text}`, { indent: 12, width: W - 12 });
    };

    // Page header
    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor("#000000")
      .text("LIABILITY WAIVER AND RENTAL AGREEMENT", { align: "center", width: W });
    doc.moveDown(0.25);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#444444")
      .text(
        `${businessLegal}  |  ${businessPhone}  |  ${businessEmail}`,
        { align: "center", width: W }
      );
    doc.moveDown(0.4);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#000000")
      .text(
        "IMPORTANT: THIS IS A LEGAL DOCUMENT. PLEASE READ CAREFULLY BEFORE SIGNING.",
        { align: "center", width: W }
      );
    doc.moveDown(0.5);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#000000")
      .text(
        `This Waiver and Release of Liability Agreement ("Agreement") is entered into by the undersigned Renter ("Renter") in favor of ${businessLegal}, and its owners, employees, agents, affiliates, and contractors ("${businessName}").`,
        { width: W, align: "justify" }
      );

    title("1. ACKNOWLEDGMENT AND ASSUMPTION OF RISK");
    para(`I understand that the use of inflatable bounce houses and related equipment carries inherent risks of injury or damage. I voluntarily assume all such risks for myself and all participants under my supervision.`);
    para(`I agree to inform all participants of the risks and safety rules and accept responsibility for their compliance during the rental period.`);
    para(`This waiver applies for the entire rental duration, including setup, idle time, and breakdown, regardless of whether the equipment is actively in use.`);

    title("2. WAIVER AND RELEASE OF LIABILITY");
    para(`I fully and forever release and discharge ${businessName} from any and all claims or liabilities arising out of injury or damage during the rental period, whether from negligence or otherwise.`);
    para(`This waiver does not apply to claims arising from gross negligence or willful misconduct by ${businessName}.`);
    para(`Gross negligence is defined as conduct so reckless as to demonstrate a substantial lack of concern for whether injury results.`);

    title("3. INDEMNIFICATION");
    para(`I agree to indemnify and hold harmless ${businessName} from any claims or liabilities arising out of the use of its equipment.`);

    title("4. RENTER'S RESPONSIBILITY");
    para(`I accept full responsibility for supervising all participants using the equipment and for communicating all safety rules.`);

    title("5. EQUIPMENT CONDITION");
    para(`I acknowledge that I have inspected the equipment and found it in good working condition at the start of the rental period. I understand I may take photos or videos of any visible damage or concerns before ${businessName} leaves the setup location and agree to share such documentation immediately.`);

    title("6. CANCELLATIONS AND REFUNDS");
    para(`I understand and agree that any deposit or initial payment made toward my reservation is refundable only if I cancel seventy-two (72) hours or more before the scheduled event time.`);
    para(`If I cancel less than seventy-two (72) hours before the event, I understand that my deposit or initial payment is non-refundable, but may be applied one (1) time toward a rescheduled date within twelve (12) months, subject to availability and the discretion of ${businessName}.`);
    para(`If ${businessName} determines that weather or safety conditions make delivery or setup unsafe, my reservation will be eligible for one (1) free reschedule within twelve (12) months. No monetary refunds will be issued for weather-related cancellations.`);
    para(`If ${businessName} must cancel my reservation for operational reasons unrelated to weather or safety, I may be offered a refund or a rescheduled date at the sole discretion of ${businessName}.`);
    para(`Once delivery has begun or setup has started at the event location, I understand that no refunds or credits of any kind will be provided.`);

    title("7. PHOTO AND VIDEO RELEASE (Optional)");
    para(`I consent to the use of any photos or videos taken during the event for promotional purposes by ${businessName}, unless I notify the company in writing prior to the rental date.`);

    title("8. DAMAGE RESPONSIBILITY AND FEE");
    para(`I understand and agree that I am responsible for any intentional, negligent, or reckless damage to ${businessName} equipment.`);
    para(`I may be charged a minimum of $150.00, or more depending on the extent of the damage, subject to ${businessName}'s reasonable assessment and documentation.`);
    para(`I agree to remit payment within 10 business days upon receiving a written notice and invoice.`);

    title("9. RULES AND SAFETY COMPLIANCE");
    para(`I agree to follow all instructions and safety rules provided by ${businessName}. I further acknowledge the following safety guidelines apply during the rental period and must be enforced by me as the responsible renter:`);
    for (const rule of [
      "Adult supervision is required at all times.",
      "No shoes inside the inflatable.",
      "No sharp objects, including keys, jewelry, or glasses.",
      "No food, drinks, or gum inside the inflatable.",
      "No rough play, wrestling, or climbing on the unit.",
      "Do not hang on netting, walls, or roofs.",
      "Limit occupancy by age group and size.",
      "No silly string, face paint, glitter, or confetti.",
      "Keep the unit dry unless authorized for water use.",
      "Exit immediately during rain, lightning, or winds over 15 MPH.",
      "Do not unplug or move blowers or extension cords.",
      "Do not exceed posted weight or occupancy limits.",
    ]) {
      bullet(rule);
    }
    para(`In the event of injury or emergency, I agree to call 911 immediately and notify ${businessName} as soon as reasonably possible.`);
    para(`I agree to monitor weather conditions and cease use of the equipment in unsafe weather including, but not limited to, rain, high winds, or lightning.`);
    para(`I acknowledge that I have received and reviewed the safety instructions provided by ${businessName} and had the opportunity to ask questions.`);

    title("10. GOVERNING LAW");
    para(`This Agreement shall be governed by and construed in accordance with the laws of the State of Michigan. Any legal action or proceeding arising out of this Agreement shall be brought exclusively in the courts of Wayne County, Michigan, and the parties hereby consent to the jurisdiction of such courts.`);

    title("11. SEVERABILITY");
    para(`If any provision is found invalid, the rest remains enforceable.`);

    title("12. ENTIRE AGREEMENT");
    para(`This Agreement reflects the complete understanding between ${businessName} and the Renter.`);

    title("13. MINORS");
    para(`If participants under the age of 18 will be present, I acknowledge that I am their parent/legal guardian or have secured the consent of their parent/legal guardian and accept all terms of this Agreement on their behalf.`);
    para(`If I am not the parent or legal guardian of participating minors, I affirm I have obtained written consent from the responsible parties agreeing to the terms of this waiver.`);

    title("14. INSURANCE DISCLAIMER");
    para(`${businessName} does not provide medical or liability insurance for injuries sustained while using the equipment.`);

    if (isWayneCounty) {
      title("15. WAYNE COUNTY AND WAYNE COUNTY PARKS \u2014 INDEPENDENT PROVIDER");
      para(`The inflatable equipment is provided, installed, and operated solely by Bounce Party Club LLC and not by Wayne County or Wayne County Parks.`);
      para(`The renter acknowledges that Wayne County and Wayne County Parks are not responsible for the operation, supervision, maintenance, or use of the inflatable equipment.`);
    }

    // Signature block
    doc.moveDown(1.5);
    doc
      .moveTo(55, doc.y)
      .lineTo(doc.page.width - 55, doc.y)
      .lineWidth(0.75)
      .stroke("#000000");
    doc.moveDown(0.75);

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#000000")
      .text("SIGNATURE AND ACCEPTANCE", { align: "center", width: W });
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(10).text("Full Legal Name:", { continued: true });
    doc.font("Helvetica").text(`  ${fullName || "___________________________________"}`);
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(10).text("Signature:", { continued: true });
    doc.font("Helvetica").text("  _____________________________________________", { continued: true });
    doc.font("Helvetica-Bold").text("    Date:", { continued: true });
    doc.font("Helvetica").text("  ___________________");

    // Add footer on last page (page 1 started manually; subsequent via pageAdded event)
    addFooter();

    // Patch: re-add footer on any additional pages via the event
    // (pageAdded fires before content, so we track and add footers at end)
    doc.end();

    await new Promise<void>((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(chunks);

    return new Response(pdfBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[generate-blank-waiver] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
