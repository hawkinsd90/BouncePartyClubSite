import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Polyfill Buffer before pdfkit loads so it finds it as a global.
import { Buffer } from "node:buffer";
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
const { default: PDFDocument } = await import("npm:pdfkit");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WAYNE_COUNTY_ORDER_ID = "4ae9723c-936f-4155-ad93-2e47ef844feb";

// Sections that require initials + date at the bottom.
const INITIALS_SECTIONS = new Set([
  "CANCELLATIONS AND REFUNDS",
  "DAMAGE RESPONSIBILITY AND FEE",
  "RULES AND SAFETY COMPLIANCE",
]);

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function dateFileTag(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
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

    // Fetch order + customer + address
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

    // Fetch business settings
    const { data: settingsRows } = await supabase
      .from("admin_settings")
      .select("key, value");

    const settings: Record<string, string> = {};
    for (const row of settingsRows ?? []) {
      settings[row.key] = row.value;
    }

    const businessName = settings["business_name_short"] ?? settings["business_name"] ?? "Bounce Party Club";
    const businessLegal = settings["business_legal_entity"] ?? "Bounce Party Club LLC";
    const businessAddress = settings["business_address"] ?? "4426 Woodward St, Wayne, MI 48184";
    const businessPhone = settings["business_phone"] ?? "(313) 889-3860";
    const businessEmail = settings["business_email"] ?? "admin@bouncepartyclub.com";
    const logoUrl = settings["logo_url"] ?? "";

    const customer = order.customers as { first_name: string; last_name: string } | null;
    const address = order.addresses as { line1: string; city: string; state: string; zip: string } | null;

    const fullName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ");
    const lastName = customer?.last_name ?? "Customer";
    const addressLine = address
      ? `${address.line1}, ${address.city}, ${address.state} ${address.zip}`
      : "";
    const eventDateFormatted = order.event_date ? formatEventDate(order.event_date) : "";
    const fileDateTag = order.event_date ? dateFileTag(order.event_date) : "unknown";
    const filename = `BPC-Liability-Waiver-${lastName}-${fileDateTag}.pdf`;

    const isWayneCounty = orderId === WAYNE_COUNTY_ORDER_ID;

    // Fetch logo once
    const logoBuffer = logoUrl ? await fetchImageBuffer(logoUrl) : null;

    // ── PDF layout constants ──────────────────────────────────────────
    const marginH = 55;
    const pageW = 612;
    const pageH = 792;
    const contentW = pageW - marginH * 2;
    // Header height = title + logo + business line + gap
    const HEADER_H = logoBuffer ? 110 : 60;
    const FOOTER_H = 30;
    const marginTop = 40; // top of page to start of header

    const chunks: Buffer[] = [];
    let pageNumber = 0;
    let totalPages = 0; // will be set after first pass (we do single pass + placeholder)

    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: marginTop + HEADER_H, bottom: FOOTER_H + 20, left: marginH, right: marginH },
      bufferPages: true, // keeps all pages in memory so we can add footers at end
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    // ── Helpers ──────────────────────────────────────────────────────
    const drawHeader = () => {
      const y0 = marginTop;
      // Title
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#000000")
        .text("LIABILITY WAIVER AND RENTAL AGREEMENT", marginH, y0, {
          width: contentW,
          align: "center",
          lineBreak: false,
        });

      let nextY = y0 + 20;

      // Logo
      if (logoBuffer) {
        const logoW = 60;
        const logoH = 60;
        const logoX = (pageW - logoW) / 2;
        doc.image(logoBuffer, logoX, nextY, { width: logoW, height: logoH, fit: [logoW, logoH] });
        nextY += logoH + 4;
      }

      // Business info line
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#333333")
        .text(
          `${businessLegal}  ${businessAddress}  |  ${businessPhone}  |  ${businessEmail}`,
          marginH,
          nextY,
          { width: contentW, align: "center", lineBreak: false }
        );

      // Thin divider
      nextY += 14;
      doc
        .moveTo(marginH, nextY)
        .lineTo(pageW - marginH, nextY)
        .lineWidth(0.4)
        .strokeColor("#cccccc")
        .stroke();

      doc.fillColor("#000000");
    };

    const drawFooter = (pageNum: number, total: number) => {
      const y = pageH - FOOTER_H + 2;
      const footerParts = [
        fullName ? `Prepared For: ${fullName}` : null,
        addressLine || null,
        eventDateFormatted || null,
      ].filter(Boolean).join("  ·  ");

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#666666")
        .text(`Page ${pageNum} / ${total}`, marginH, y, {
          width: contentW / 3,
          align: "left",
          lineBreak: false,
        });

      if (footerParts) {
        doc.text(footerParts, marginH + contentW / 3, y, {
          width: (contentW * 2) / 3,
          align: "right",
          lineBreak: false,
        });
      }
    };

    // ── Section rendering helpers ─────────────────────────────────────
    const sectionTitle = (text: string) => {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text(text, { width: contentW });
      doc.font("Helvetica").fontSize(9.5).fillColor("#000000");
    };

    const para = (text: string) => {
      doc.moveDown(0.35);
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#000000")
        .text(text, { width: contentW, align: "justify" });
    };

    const bulletItem = (text: string) => {
      doc.moveDown(0.2);
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#000000")
        .text(`\u2022  ${text}`, { indent: 12, width: contentW - 12 });
    };

    // Initials line printed after certain sections
    const initialsLine = () => {
      doc.moveDown(0.6);
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#000000");
      doc.text("Initials:", marginH, y, { continued: true, lineBreak: false });
      doc.text("  _______________________", { continued: true, lineBreak: false });
      doc.text("     Date:", { continued: true, lineBreak: false });
      doc.text("  _______________________");
      doc.moveDown(0.4);
    };

    // ── Draw header on page 1 ────────────────────────────────────────
    pageNumber = 1;
    drawHeader();

    // pdfkit fires pageAdded for pages 2+ when it auto-paginates
    doc.on("pageAdded", () => {
      pageNumber++;
      drawHeader();
    });

    // ── Intro paragraph ──────────────────────────────────────────────
    doc.moveDown(0.6);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#000000")
      .text(
        "IMPORTANT: THIS IS A LEGAL DOCUMENT. PLEASE READ CAREFULLY BEFORE SIGNING.",
        { width: contentW, align: "center" }
      );
    doc.moveDown(0.4);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#000000")
      .text(
        `This Waiver and Release of Liability Agreement ("Agreement") is entered into by the undersigned Renter ("Renter") in favor of ${businessLegal}, and its owners, employees, agents, affiliates, and contractors ("${businessName}").`,
        { width: contentW, align: "justify" }
      );

    // ── Section 1 ────────────────────────────────────────────────────
    sectionTitle("1. ACKNOWLEDGMENT AND ASSUMPTION OF RISK");
    para(`I understand that the use of inflatable bounce houses and related equipment carries inherent risks of injury or damage. I voluntarily assume all such risks for myself and all participants under my supervision.`);
    para(`I agree to inform all participants of the risks and safety rules and accept responsibility for their compliance during the rental period.`);
    para(`This waiver applies for the entire rental duration, including setup, idle time, and breakdown, regardless of whether the equipment is actively in use.`);

    // ── Section 2 ────────────────────────────────────────────────────
    sectionTitle("2. WAIVER AND RELEASE OF LIABILITY");
    para(`I fully and forever release and discharge ${businessName} from any and all claims or liabilities arising out of injury or damage during the rental period, whether from negligence or otherwise.`);
    para(`This waiver does not apply to claims arising from gross negligence or willful misconduct by ${businessName}.`);
    para(`Gross negligence is defined as conduct so reckless as to demonstrate a substantial lack of concern for whether injury results.`);

    // ── Section 3 ────────────────────────────────────────────────────
    sectionTitle("3. INDEMNIFICATION");
    para(`I agree to indemnify and hold harmless ${businessName} from any claims or liabilities arising out of the use of its equipment.`);

    // ── Section 4 ────────────────────────────────────────────────────
    sectionTitle("4. RENTER'S RESPONSIBILITY");
    para(`I accept full responsibility for supervising all participants using the equipment and for communicating all safety rules.`);

    // ── Section 5 ────────────────────────────────────────────────────
    sectionTitle("5. EQUIPMENT CONDITION");
    para(`I acknowledge that I have inspected the equipment and found it in good working condition at the start of the rental period. I understand I may take photos or videos of any visible damage or concerns before ${businessName} leaves the setup location and agree to share such documentation immediately.`);

    // ── Section 6 — INITIALS REQUIRED ───────────────────────────────
    sectionTitle("6. CANCELLATIONS AND REFUNDS");
    para(`I understand and agree that any deposit or initial payment made toward my reservation is refundable only if I cancel seventy-two (72) hours or more before the scheduled event time.`);
    para(`If I cancel less than seventy-two (72) hours before the event, I understand that my deposit or initial payment is non-refundable, but may be applied one (1) time toward a rescheduled date within twelve (12) months, subject to availability and the discretion of ${businessName}.`);
    para(`If ${businessName} determines that weather or safety conditions make delivery or setup unsafe, my reservation will be eligible for one (1) free reschedule within twelve (12) months. No monetary refunds will be issued for weather-related cancellations.`);
    para(`If ${businessName} must cancel my reservation for operational reasons unrelated to weather or safety, I may be offered a refund or a rescheduled date at the sole discretion of ${businessName}.`);
    para(`Once delivery has begun or setup has started at the event location, I understand that no refunds or credits of any kind will be provided.`);
    initialsLine();

    // ── Section 7 ────────────────────────────────────────────────────
    sectionTitle("7. PHOTO AND VIDEO RELEASE (Optional)");
    para(`I consent to the use of any photos or videos taken during the event for promotional purposes by ${businessName}, unless I notify the company in writing prior to the rental date.`);

    // ── Section 8 — INITIALS REQUIRED ───────────────────────────────
    sectionTitle("8. DAMAGE RESPONSIBILITY AND FEE");
    para(`I understand and agree that I am responsible for any intentional, negligent, or reckless damage to ${businessName} equipment.`);
    para(`I may be charged a minimum of $150.00, or more depending on the extent of the damage, subject to ${businessName}'s reasonable assessment and documentation.`);
    para(`I agree to remit payment within 10 business days upon receiving a written notice and invoice.`);
    initialsLine();

    // ── Section 9 — INITIALS REQUIRED ───────────────────────────────
    sectionTitle("9. RULES AND SAFETY COMPLIANCE");
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
      bulletItem(rule);
    }
    para(`In the event of injury or emergency, I agree to call 911 immediately and notify ${businessName} as soon as reasonably possible.`);
    para(`I agree to monitor weather conditions and cease use of the equipment in unsafe weather including, but not limited to, rain, high winds, or lightning.`);
    para(`I acknowledge that I have received and reviewed the safety instructions provided by ${businessName} and had the opportunity to ask questions.`);
    initialsLine();

    // ── Section 10 ───────────────────────────────────────────────────
    sectionTitle("10. GOVERNING LAW");
    para(`This Agreement shall be governed by and construed in accordance with the laws of the State of Michigan. Any legal action or proceeding arising out of this Agreement shall be brought exclusively in the courts of Wayne County, Michigan, and the parties hereby consent to the jurisdiction of such courts.`);

    // ── Section 11 ───────────────────────────────────────────────────
    sectionTitle("11. SEVERABILITY");
    para(`If any provision is found invalid, the rest remains enforceable.`);

    // ── Section 12 ───────────────────────────────────────────────────
    sectionTitle("12. ENTIRE AGREEMENT");
    para(`This Agreement reflects the complete understanding between ${businessName} and the Renter.`);

    // ── Section 13 ───────────────────────────────────────────────────
    sectionTitle("13. MINORS");
    para(`If participants under the age of 18 will be present, I acknowledge that I am their parent/legal guardian or have secured the consent of their parent/legal guardian and accept all terms of this Agreement on their behalf.`);
    para(`If I am not the parent or legal guardian of participating minors, I affirm I have obtained written consent from the responsible parties agreeing to the terms of this waiver.`);

    // ── Section 14 ───────────────────────────────────────────────────
    sectionTitle("14. INSURANCE DISCLAIMER");
    para(`${businessName} does not provide medical or liability insurance for injuries sustained while using the equipment.`);

    // ── Section 15 — Wayne County only ──────────────────────────────
    if (isWayneCounty) {
      sectionTitle("15. WAYNE COUNTY AND WAYNE COUNTY PARKS \u2014 INDEPENDENT PROVIDER");
      para(`The inflatable equipment is provided, installed, and operated solely by Bounce Party Club LLC and not by Wayne County or Wayne County Parks.`);
      para(`The renter acknowledges that Wayne County and Wayne County Parks are not responsible for the operation, supervision, maintenance, or use of the inflatable equipment.`);
    }

    // ── Signature block ──────────────────────────────────────────────
    doc.moveDown(1.5);
    doc
      .moveTo(marginH, doc.y)
      .lineTo(pageW - marginH, doc.y)
      .lineWidth(0.75)
      .strokeColor("#000000")
      .stroke();
    doc.moveDown(0.75);

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#000000")
      .text("SIGNATURE AND ACCEPTANCE", { align: "center", width: contentW });
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(10).text("Full Legal Name:", { continued: true });
    doc.font("Helvetica").text(`  ${fullName || "_________________________________"}`);
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(10).text("Signature:", { continued: true });
    doc.font("Helvetica").text("  ___________________________________________", { continued: true });
    doc.font("Helvetica-Bold").text("    Date:", { continued: true });
    doc.font("Helvetica").text("  ___________________");

    // ── Flush + add footers to every page ───────────────────────────
    const totalPageCount = (doc as { bufferedPageRange: () => { count: number } }).bufferedPageRange().count;

    for (let i = 0; i < totalPageCount; i++) {
      doc.switchToPage(i);
      drawFooter(i + 1, totalPageCount);
    }

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
