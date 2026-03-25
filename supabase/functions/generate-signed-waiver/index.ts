import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { jsPDF } from "npm:jspdf@2.5.2";

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

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "letter",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("LIABILITY WAIVER AND RENTAL AGREEMENT", pageWidth / 2, yPosition, {
      align: "center",
    });

    yPosition += 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Bounce Party Club LLC", pageWidth / 2, yPosition, { align: "center" });
    yPosition += 5;
    doc.text(`Version ${signature.waiver_version}`, pageWidth / 2, yPosition, {
      align: "center",
    });

    yPosition += 10;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    doc.setFontSize(9);
    const waiverLines = doc.splitTextToSize(signature.waiver_text_snapshot, maxWidth);

    for (const line of waiverLines) {
      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }

      doc.text(line, margin, yPosition);
      yPosition += 5;
    }

    if (yPosition > pageHeight - 80) {
      doc.addPage();
      yPosition = margin;
    }

    yPosition += 10;
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("SIGNATURE AND ACCEPTANCE", pageWidth / 2, yPosition, {
      align: "center",
    });
    yPosition += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    doc.text("Typed Legal Name:", margin, yPosition);
    doc.setFont("helvetica", "bold");
    doc.text(signature.typed_name, margin + 50, yPosition);
    yPosition += 8;

    doc.setFont("helvetica", "normal");
    doc.text("Email:", margin, yPosition);
    doc.setFont("helvetica", "bold");
    doc.text(signature.signer_email, margin + 50, yPosition);
    yPosition += 8;

    if (signature.signer_phone) {
      doc.setFont("helvetica", "normal");
      doc.text("Phone:", margin, yPosition);
      doc.setFont("helvetica", "bold");
      doc.text(signature.signer_phone, margin + 50, yPosition);
      yPosition += 8;
    }

    doc.setFont("helvetica", "normal");
    doc.text("Date Signed:", margin, yPosition);
    doc.setFont("helvetica", "bold");
    doc.text(
      new Date(signature.signed_at).toLocaleString("en-US", {
        dateStyle: "full",
        timeStyle: "long",
      }),
      margin + 50,
      yPosition
    );
    yPosition += 8;

    doc.setFont("helvetica", "normal");
    doc.text("IP Address:", margin, yPosition);
    doc.setFont("helvetica", "bold");
    doc.text(signature.ip_address, margin + 50, yPosition);
    yPosition += 12;

    if (signature.initials_data && Object.keys(signature.initials_data).length > 0) {
      doc.setFont("helvetica", "bold");
      doc.text("Initials Provided:", margin, yPosition);
      yPosition += 6;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      for (const [section, initial] of Object.entries(signature.initials_data)) {
        doc.text(`• ${section}: ${initial}`, margin + 5, yPosition);
        yPosition += 5;
      }
      yPosition += 5;
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Electronic Signature:", margin, yPosition);
    yPosition += 8;

    try {
      const signatureImgResponse = await fetch(signature.signature_image_url);
      if (signatureImgResponse.ok) {
        const signatureBlob = await signatureImgResponse.arrayBuffer();
        const base64Signature = btoa(
          String.fromCharCode(...new Uint8Array(signatureBlob))
        );
        const signatureDataUrl = `data:image/png;base64,${base64Signature}`;

        doc.addImage(signatureDataUrl, "PNG", margin, yPosition, 80, 25);
        yPosition += 30;
      }
    } catch (imgError) {
      console.error("Failed to add signature image:", imgError);
      doc.setFont("helvetica", "italic");
      doc.text("[Signature image unavailable]", margin, yPosition);
      yPosition += 10;
    }

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text(
      "This document was electronically signed and is legally binding under the ESIGN Act and UETA.",
      pageWidth / 2,
      pageHeight - 15,
      { align: "center" }
    );
    doc.text(
      `Document ID: ${signature.id}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );

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

    const { error: updateSigError } = await supabaseClient
      .from("order_signatures")
      .update({
        pdf_url: pdfUrl,
        pdf_generated_at: new Date().toISOString(),
      })
      .eq("id", signatureId);

    if (updateSigError) {
      console.error("Failed to update signature record:", updateSigError);
    }

    const { error: updateOrderError } = await supabaseClient
      .from("orders")
      .update({
        signed_waiver_url: pdfUrl,
      })
      .eq("id", signature.order_id);

    if (updateOrderError) {
      console.error("Failed to update order:", updateOrderError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl,
        message: "Signed waiver PDF generated successfully",
      }),
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
