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

    // Determine whether caller is authorized to receive signed URLs for physical waivers.
    // Signed URLs are private (1h expiry) and should only be returned to:
    //   (a) a verified portal token that matches this order, OR
    //   (b) an authenticated admin/master/crew session
    let canReceiveSignedUrl = false;

    // Check for valid portal token
    if (token) {
      const { data: link } = await supabaseClient
        .from("invoice_links")
        .select("order_id, expires_at")
        .eq("link_token", token)
        .maybeSingle();
      if (link && link.order_id === orderId) {
        const notExpired = !link.expires_at || new Date(link.expires_at) >= new Date();
        if (notExpired) canReceiveSignedUrl = true;
      }
    }

    // Check for admin/crew JWT if no valid token yet
    if (!canReceiveSignedUrl) {
      const authHeader = req.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const jwt = authHeader.slice(7);
        const anonClient = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? ""
        );
        const { data: userData } = await anonClient.auth.getUser(jwt);
        if (userData?.user) {
          const { data: roleData } = await supabaseClient
            .rpc("get_user_role", { p_user_id: userData.user.id });
          const role = roleData as string | null;
          if (role && ["admin", "master", "crew"].includes(role)) {
            canReceiveSignedUrl = true;
          }
        }
      }
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
      if (sig.physical_waiver_storage_path && canReceiveSignedUrl) {
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
