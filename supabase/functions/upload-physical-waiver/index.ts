import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const contentType = req.headers.get("content-type") ?? "";

    let orderId: string | null = null;
    let token: string | null = null;
    let uploadSource: string | null = null;
    let overrideReason: string | null = null;
    let fileData: Uint8Array | null = null;
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let isAdminRequest = false;
    let uploaderUserId: string | null = null;
    let uploaderRole: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      orderId = form.get("orderId") as string | null;
      token = form.get("token") as string | null;
      uploadSource = (form.get("uploadSource") as string | null) ?? "unknown";
      overrideReason = form.get("overrideReason") as string | null;

      const file = form.get("file") as File | null;
      if (file) {
        fileMime = file.type;
        fileName = file.name;
        fileData = new Uint8Array(await file.arrayBuffer());
      }
    } else {
      return jsonError("Content-Type must be multipart/form-data", 400);
    }

    if (!orderId || typeof orderId !== "string") {
      return jsonError("orderId required", 400);
    }

    // Determine access path: admin/crew (JWT) vs customer portal (token)
    const authHeader = req.headers.get("authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const jwt = authHeader.slice(7);
      // Verify JWT using anon client
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? ""
      );
      const { data: userData, error: userError } = await anonClient.auth.getUser(jwt);
      if (userError || !userData?.user) {
        return jsonError("Unauthorized", 401);
      }
      uploaderUserId = userData.user.id;

      // Check role
      const { data: roleData } = await supabaseClient
        .rpc("get_user_role", { p_user_id: uploaderUserId });
      uploaderRole = roleData as string | null;

      if (!uploaderRole || !["admin", "master", "crew"].includes(uploaderRole)) {
        return jsonError("Forbidden: insufficient role", 403);
      }
      isAdminRequest = true;
    } else if (token) {
      // Customer portal path: validate token
      const { data: link } = await supabaseClient
        .from("invoice_links")
        .select("order_id, expires_at")
        .eq("link_token", token)
        .maybeSingle();

      if (!link || link.order_id !== orderId) {
        return jsonError("Invalid or expired token", 403);
      }
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return jsonError("Link expired", 403);
      }
      uploadSource = "customer_portal";
    } else {
      return jsonError("Authentication required", 401);
    }

    // Verify order exists
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return jsonError("Order not found", 404);
    }

    // No-file override: admin only, requires overrideReason
    if (!fileData) {
      if (!isAdminRequest) {
        return jsonError("File is required", 400);
      }
      if (!overrideReason || !overrideReason.trim()) {
        return jsonError("overrideReason is required when marking paper waiver without a photo", 400);
      }

      // Upsert order_signatures (paper, no file)
      const now = new Date().toISOString();
      const { error: upsertError } = await supabaseClient
        .from("order_signatures")
        .upsert(
          {
            order_id: orderId,
            waiver_version: "paper",
            ip_address: "0.0.0.0",
            user_agent: "Admin - Paper Waiver Signed On-Site",
            electronic_consent_given: false,
            physical_waiver_storage_path: null,
            physical_waiver_uploaded_at: now,
            physical_waiver_uploaded_by: uploaderUserId,
            physical_waiver_uploaded_by_role: uploaderRole,
            physical_waiver_file_type: null,
            physical_waiver_original_filename: null,
            physical_waiver_upload_source: uploadSource,
            physical_waiver_override_reason: overrideReason.trim(),
            signed_at: now,
          },
          { onConflict: "order_id" }
        );

      if (upsertError) {
        console.error("[upload-physical-waiver] upsert error:", upsertError.message);
        return jsonError("Failed to record waiver", 500);
      }

      await supabaseClient
        .from("orders")
        .update({ waiver_signed_at: now, e_signature_consent: false })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({ success: true, hasFile: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // File provided — validate type
    if (fileMime === "image/heic" || fileMime === "image/heif" ||
        fileName?.toLowerCase().endsWith(".heic") || fileName?.toLowerCase().endsWith(".heif")) {
      return jsonError(
        "HEIC photos are not supported. Please convert to JPEG before uploading. On iPhone: Settings > Camera > Formats > Most Compatible",
        415
      );
    }

    if (!ALLOWED_MIME_TYPES.has(fileMime ?? "")) {
      return jsonError(`File type not allowed: ${fileMime}. Accepted: JPEG, PNG, WebP, PDF`, 415);
    }

    // Upload to private bucket
    const timestamp = Date.now();
    const safeFileName = safeName(fileName ?? "waiver");
    const storagePath = `${orderId}/${timestamp}-${safeFileName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("physical-waivers")
      .upload(storagePath, fileData, {
        contentType: fileMime ?? "application/octet-stream",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload-physical-waiver] storage upload error:", uploadError.message);
      return jsonError(`Failed to upload file: ${uploadError.message}`, 500);
    }

    const now = new Date().toISOString();

    const { error: upsertError } = await supabaseClient
      .from("order_signatures")
      .upsert(
        {
          order_id: orderId,
          waiver_version: "paper",
          ip_address: req.headers.get("x-forwarded-for") ?? "0.0.0.0",
          user_agent: req.headers.get("user-agent") ?? "unknown",
          electronic_consent_given: false,
          physical_waiver_storage_path: storagePath,
          physical_waiver_uploaded_at: now,
          physical_waiver_uploaded_by: uploaderUserId,
          physical_waiver_uploaded_by_role: uploaderRole,
          physical_waiver_file_type: fileMime,
          physical_waiver_original_filename: fileName,
          physical_waiver_upload_source: uploadSource,
          physical_waiver_override_reason: null,
          signed_at: now,
        },
        { onConflict: "order_id" }
      );

    if (upsertError) {
      console.error("[upload-physical-waiver] upsert error:", upsertError.message);
      return jsonError("Failed to record waiver", 500);
    }

    await supabaseClient
      .from("orders")
      .update({ waiver_signed_at: now, e_signature_consent: false })
      .eq("id", orderId);

    return new Response(
      JSON.stringify({ success: true, hasFile: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[upload-physical-waiver] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
