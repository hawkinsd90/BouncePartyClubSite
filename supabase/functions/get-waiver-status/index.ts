import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { authorizePortalOrder, callerHasAnyRole, resolveCaller, userOwnsOrderCanonical } from "../_shared/auth.ts";
import { signStoredMedia } from "../_shared/evidence/media-paths.ts";

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

    // Waiver status (who signed, when, initials, whether a PDF or a paper scan exists) and the private waiver files are
    // returned only to a caller who is authorized for THIS order; everyone else gets exactly the same answer as for an order
    // that has no waiver ({ signed: false, data: null }), so the response cannot be used to learn whether an order or a waiver
    // exists. Authorized callers receive short-lived (1 hour) signed URLs:
    //   (a) a valid, unexpired, unrevoked portal or invoice token bound to this order, OR
    //   (b) the signed-in customer who owns this order (direct, or through the historical profile / contact link), OR
    //   (c) a signed-in admin / master / crew session (or the service role).
    // The order id alone, the public anon key, an email or a phone number are never enough.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const caller = await resolveCaller(supabaseClient, req.headers.get("authorization"), serviceKey);
    const proof = await authorizePortalOrder(supabaseClient, { orderId, token, caller, allowStaffRead: true });
    let authorized = !!proof || callerHasAnyRole(caller, ["admin", "master", "crew"]);
    if (!authorized && caller.kind === "user") {
      authorized = await userOwnsOrderCanonical(supabaseClient, caller.userId, orderId);
    }
    if (!authorized) {
      return new Response(JSON.stringify({ signed: false, data: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify order exists
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

    // Generate signed URL only for authorized callers
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

    // Stored references may be historical public URLs; they are converted to a bucket path and signed. An unauthorized caller
    // receives no URL at all (never the stored public URL).
    const signatureImageUrl = await signStoredMedia(supabaseClient, "signatures", sig.signature_image_url);
    const pdfUrl = await signStoredMedia(supabaseClient, "signed-waivers", sig.pdf_url);

    const responseData = {
      signed_at: sig.signed_at,
      signer_name: sig.signer_name,
      waiver_version: sig.waiver_version,
      initials_data: sig.initials_data,
      signature_image_url: signatureImageUrl,
      pdf_url: pdfUrl,
      has_signature_image: !!sig.signature_image_url,
      has_pdf: !!sig.pdf_url,
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
