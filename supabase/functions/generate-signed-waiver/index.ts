import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jsPDF } from "npm:jspdf@2.5.2";
import {
  MARGIN,
  INLINE_INITIALS_SECTIONS,
  SECTION_INITIALS_KEYS,
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
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { signatureId } = await req.json();

    if (!signatureId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing signatureId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: signature, error: sigError } = await supabaseClient
      .from("order_signatures")
      .select("*")
      .eq("id", signatureId)
      .single();

    if (sigError || !signature) {
      return new Response(
        JSON.stringify({ success: false, error: "Signature not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch business settings (logo + info line)
    const { data: settings } = await supabaseClient
      .from("admin_settings")
      .select("key, value")
      .in("key", ["logo_url", "business_name", "business_name_short", "business_legal_entity", "business_address", "business_phone", "business_email"]);

    const sm: Record<string, string> = {};
    for (const row of settings ?? []) {
      if (row.key && row.value) sm[row.key] = row.value;
    }

    const logoUrl = sm["logo_url"] || null;
    const businessLegalEntity = sm["business_legal_entity"] || sm["business_name"] || "Bounce Party Club LLC";
    const businessAddress = sm["business_address"] || "";
    const businessPhone = sm["business_phone"] || "";
    const businessEmail = sm["business_email"] || "";
    const businessInfoLine = [
      businessLegalEntity,
      [businessAddress, businessPhone, businessEmail].filter(Boolean).join(" | "),
    ].filter(Boolean).join("  ");

    // Pre-fetch logo using chunked converter
    const logoResult = logoUrl ? await fetchLogoDataUrl(logoUrl) : null;
    const logoDataUrl = logoResult?.dataUrl ?? null;
    const logoExt: "JPEG" | "PNG" = logoResult?.ext ?? "PNG";

    // Pre-fetch signature image using same chunked converter
    let sigImgDataUrl: string | null = null;
    if (signature.signature_image_url) {
      try {
        const res = await fetch(signature.signature_image_url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1024) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
          }
          sigImgDataUrl = `data:image/png;base64,${btoa(binary)}`;
        }
      } catch { /* continue without signature image */ }
    }

    // Parse waiver text snapshot into sections (same parser as blank waiver)
    const blocks = parseWaiverSections(signature.waiver_text_snapshot || "");

    // Build a quick-lookup map: section name → initials string
    const initialsMap: Record<string, string> = {};
    if (signature.initials_data && typeof signature.initials_data === "object") {
      for (const [k, v] of Object.entries(signature.initials_data)) {
        initialsMap[k] = v as string;
      }
    }

    const signedDateFormatted = new Date(signature.signed_at).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });

    // PDF setup
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - 2 * MARGIN;
    const contentMaxY = pageHeight - 18;

    // Render page 1 header
    let y = renderPageHeader(doc, MARGIN, logoDataUrl, logoExt, businessInfoLine);
    const contentStartY = y;

    const addPage = () => { doc.addPage(); y = contentStartY; };
    const ensureSpace = (needed: number) => { if (y + needed > contentMaxY) addPage(); };

    // ── WAIVER BODY ────────────────────────────────────────────────────────────
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

      // Inline initials after sections 6, 8, 9 — show actual initials provided
      if (block.sectionNumber !== null && INLINE_INITIALS_SECTIONS.has(block.sectionNumber)) {
        const sectionKey = SECTION_INITIALS_KEYS[block.sectionNumber];
        const initial = initialsMap[sectionKey] ?? "";
        ensureSpace(14);
        y += 2;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text("Initials:", MARGIN, y);

        if (initial) {
          // Show initials in a shaded box to distinguish from blank waiver lines
          doc.setFillColor(240, 245, 255);
          doc.setDrawColor(100, 140, 200);
          doc.rect(MARGIN + 22, y - 4, 18, 6, "FD");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(30, 60, 130);
          doc.text(initial, MARGIN + 31, y, { align: "center" });
          doc.setTextColor(0, 0, 0);
          doc.setFontSize(9);
        } else {
          doc.setFont("helvetica", "normal");
          doc.line(MARGIN + 22, y + 1, MARGIN + 62, y + 1);
        }

        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("Date:", MARGIN + 70, y);
        doc.setFont("helvetica", "normal");
        if (signedDateFormatted) {
          doc.setFontSize(9);
          doc.text(signedDateFormatted, MARGIN + 82, y);
        } else {
          doc.line(MARGIN + 82, y + 1, MARGIN + 130, y + 1);
        }
        y += 10;
      }
    }

    // ── SIGNATURE BLOCK ────────────────────────────────────────────────────────
    ensureSpace(80);
    y += 4;
    doc.setDrawColor(0, 0, 0);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("SIGNATURE AND ACCEPTANCE", pageWidth / 2, y, { align: "center" });
    y += 10;

    const field = (label: string, value: string) => {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      doc.text(`${label}:`, MARGIN, y);
      doc.setFont("helvetica", "bold");
      doc.text(value, MARGIN + 50, y);
      y += 8;
    };

    field("Typed Legal Name", signature.typed_name || signature.signer_name || "");
    field("Email", signature.signer_email || "");
    if (signature.signer_phone) field("Phone", signature.signer_phone);
    field("Date Signed", new Date(signature.signed_at).toLocaleString("en-US", { dateStyle: "full", timeStyle: "long", timeZone: "America/Detroit" }).replace(" EDT", " EST"));
    field("IP Address", signature.ip_address || "");
    y += 4;

    if (sigImgDataUrl) {
      ensureSpace(40);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("Electronic Signature:", MARGIN, y);
      y += 8;
      doc.addImage(sigImgDataUrl, "PNG", MARGIN, y, 80, 25);
      y += 30;
    } else {
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 100, 100);
      doc.text("[Signature image unavailable]", MARGIN, y);
      y += 10;
    }

    // Legal notice at the very bottom of the last content page
    if (y + 12 <= contentMaxY) {
      y += 4;
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(100, 100, 100);
      doc.text(
        "This document was electronically signed and is legally binding under the ESIGN Act and UETA.",
        pageWidth / 2, y, { align: "center" }
      );
      y += 5;
      doc.text(`Document ID: ${signature.id}`, pageWidth / 2, y, { align: "center" });
    }

    // ── HEADERS (pages 2+) AND FOOTERS (all pages) ─────────────────────────────
    stampAllPageHeaders(doc, contentStartY, logoDataUrl, logoExt, businessInfoLine);

    const footerRight = `Signed by: ${signature.signer_name || ""}  ·  ${signedDateFormatted}`;
    stampAllPageFooters(doc, footerRight);

    // ── UPLOAD PDF TO STORAGE ──────────────────────────────────────────────────
    const pdfBuffer = doc.output("arraybuffer");
    const pdfUint8Array = new Uint8Array(pdfBuffer);

    const pdfFileName = `waiver-${signature.order_id}-${Date.now()}.pdf`;
    const { data: pdfUpload, error: pdfUploadError } = await supabaseClient.storage
      .from("signed-waivers")
      .upload(pdfFileName, pdfUint8Array, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: false,
      });

    if (pdfUploadError) {
      console.error("PDF upload error:", pdfUploadError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to upload PDF: ${pdfUploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: pdfUrlData } = supabaseClient.storage
      .from("signed-waivers")
      .getPublicUrl(pdfUpload.path);
    const pdfUrl = pdfUrlData.publicUrl;

    await supabaseClient
      .from("order_signatures")
      .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
      .eq("id", signatureId);

    await supabaseClient
      .from("orders")
      .update({ signed_waiver_url: pdfUrl })
      .eq("id", signature.order_id);

    return new Response(
      JSON.stringify({ success: true, pdfUrl, message: "Signed waiver PDF generated successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("generate-signed-waiver error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
