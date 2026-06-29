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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { orderId } = await req.json();

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

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ signed: false, data: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sig, error: sigError } = await supabaseClient
      .from("order_signatures")
      .select(
        "signed_at, signer_name, waiver_version, initials_data, signature_image_url, pdf_url, electronic_consent_given, physical_waiver_storage_path, physical_waiver_uploaded_at, physical_waiver_file_type, physical_waiver_upload_source, physical_waiver_override_reason"
      )
      .eq("order_id", orderId)
      .maybeSingle();

    if (sigError) {
      console.error("[get-waiver-status] Signature query error:", sigError.message);
      return new Response(JSON.stringify({ error: "Failed to load waiver status" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sig) {
      return new Response(
        JSON.stringify({ signed: false, data: null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine waiver type
    let waiverType: "digital" | "paper_with_photo" | "paper_no_photo";
    if (sig.electronic_consent_given) {
      waiverType = "digital";
    } else if (sig.physical_waiver_storage_path) {
      waiverType = "paper_with_photo";
    } else {
      waiverType = "paper_no_photo";
    }

    // Generate signed URL for physical waiver if one exists
    let physicalWaiver: {
      has_file: boolean;
      signed_url: string | null;
      file_type: string | null;
      uploaded_at: string | null;
      upload_source: string | null;
    } | null = null;

    if (sig.waiver_version === "paper") {
      let signedUrl: string | null = null;
      if (sig.physical_waiver_storage_path) {
        const { data: urlData, error: urlError } = await supabaseClient.storage
          .from("physical-waivers")
          .createSignedUrl(sig.physical_waiver_storage_path, 3600);
        if (!urlError && urlData?.signedUrl) {
          signedUrl = urlData.signedUrl;
        }
      }

      physicalWaiver = {
        has_file: !!sig.physical_waiver_storage_path,
        signed_url: signedUrl,
        file_type: sig.physical_waiver_file_type ?? null,
        uploaded_at: sig.physical_waiver_uploaded_at ?? null,
        upload_source: sig.physical_waiver_upload_source ?? null,
      };
    }

    const responseData = {
      signed_at: sig.signed_at,
      signer_name: sig.signer_name,
      waiver_version: sig.waiver_version,
      initials_data: sig.initials_data,
      signature_image_url: sig.signature_image_url,
      pdf_url: sig.pdf_url,
      waiver_type: waiverType,
      physical_waiver: physicalWaiver,
    };

    return new Response(
      JSON.stringify({ signed: true, data: responseData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[get-waiver-status] Fatal error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
