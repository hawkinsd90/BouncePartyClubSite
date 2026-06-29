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
    if (!contentType.includes("multipart/form-data")) {
      return jsonError("Content-Type must be multipart/form-data", 400);
    }

    const form = await req.formData();
    const orderId = form.get("orderId") as string | null;
    const token = form.get("token") as string | null;
    const uploadSource = (form.get("uploadSource") as string | null) ?? "unknown";
    const overrideReason = form.get("overrideReason") as string | null;
    const file = form.get("file") as File | null;

    if (!orderId || typeof orderId !== "string") {
      return jsonError("orderId required", 400);
    }

    let isAdminRequest = false;
    let uploaderUserId: string | null = null;
    let uploaderRole: string | null = null;

    // Try admin/crew JWT auth first. If JWT is not a valid user session (e.g. anon key),
    // fall through to portal-token auth so customer portal uploads work correctly.
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const jwt = authHeader.slice(7);
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? ""
      );
      const { data: userData } = await anonClient.auth.getUser(jwt);

      if (userData?.user) {
        // Valid user session — check role
        uploaderUserId = userData.user.id;
        const { data: roleData } = await supabaseClient
          .rpc("get_user_role", { p_user_id: uploaderUserId });
        uploaderRole = roleData as string | null;

        if (uploaderRole && ["admin", "master", "crew"].includes(uploaderRole)) {
          isAdminRequest = true;
        } else if (!token) {
          // Authenticated user but not admin and no portal token
          return jsonError("Forbidden: insufficient role", 403);
        }
        // If authenticated but not admin and has token, fall through to token validation
      }
      // If getUser returned no user (e.g. anon key was sent), fall through to token path
    }

    // Customer portal token path
    if (!isAdminRequest) {
      if (!token) {
        return jsonError("Authentication required", 401);
      }
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
    }

    // Verify order exists and fetch customer/address data for required signature fields
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, event_date, customers(first_name, last_name, email, phone), addresses(line1, city, state, zip)")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return jsonError("Order not found", 404);
    }

    const customer = order.customers as any;
    const address = order.addresses as any;
    const customerName = customer
      ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
      : "Unknown";
    const customerEmail = customer?.email || "";
    const customerPhone = customer?.phone || "";

    const now = new Date().toISOString();
    const ipAddress = req.headers.get("x-forwarded-for") ?? "0.0.0.0";
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    // Check if a signature row already exists for this order
    const { data: existing } = await supabaseClient
      .from("order_signatures")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();

    // No-file override: admin only, requires overrideReason
    if (!file) {
      if (!isAdminRequest) {
        return jsonError("File is required", 400);
      }
      if (!overrideReason || !overrideReason.trim()) {
        return jsonError("overrideReason is required when marking paper waiver without a photo", 400);
      }

      const physicalFields = {
        waiver_version: "paper",
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
      };

      if (existing) {
        await supabaseClient
          .from("order_signatures")
          .update(physicalFields)
          .eq("id", existing.id);
      } else {
        const { error: insertError } = await supabaseClient
          .from("order_signatures")
          .insert({
            order_id: orderId,
            signer_name: customerName,
            signer_email: customerEmail,
            signer_phone: customerPhone,
            signature_image_url: "",
            typed_name: customerName,
            ip_address: ipAddress,
            user_agent: userAgent,
            waiver_text_snapshot: "",
            electronic_consent_text: "",
            event_date: order.event_date || new Date().toISOString().split("T")[0],
            event_address_line1: address?.line1 || "",
            event_city: address?.city || "",
            event_state: address?.state || "",
            event_zip: address?.zip || "",
            ...physicalFields,
          });
        if (insertError) {
          console.error("[upload-physical-waiver] insert error:", insertError.message);
          return jsonError("Failed to record waiver", 500);
        }
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

    // File provided — validate MIME type
    const fileMime = file.type;
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".heic") || lowerName.endsWith(".heif") ||
        fileMime === "image/heic" || fileMime === "image/heif") {
      return jsonError(
        "HEIC photos are not supported. Please convert to JPEG before uploading. On iPhone: Settings > Camera > Formats > Most Compatible",
        415
      );
    }

    if (!ALLOWED_MIME_TYPES.has(fileMime)) {
      return jsonError(`File type not allowed: ${fileMime}. Accepted: JPEG, PNG, WebP, PDF`, 415);
    }

    const fileData = new Uint8Array(await file.arrayBuffer());

    // Upload to private bucket
    const timestamp = Date.now();
    const safeFileName = safeName(fileName);
    const storagePath = `${orderId}/${timestamp}-${safeFileName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("physical-waivers")
      .upload(storagePath, fileData, {
        contentType: fileMime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("[upload-physical-waiver] storage upload error:", uploadError.message);
      return jsonError(`Failed to upload file: ${uploadError.message}`, 500);
    }

    const physicalFields = {
      waiver_version: "paper",
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
    };

    if (existing) {
      const { error: updateError } = await supabaseClient
        .from("order_signatures")
        .update(physicalFields)
        .eq("id", existing.id);
      if (updateError) {
        console.error("[upload-physical-waiver] update error:", updateError.message);
        return jsonError("Failed to record waiver", 500);
      }
    } else {
      const { error: insertError } = await supabaseClient
        .from("order_signatures")
        .insert({
          order_id: orderId,
          signer_name: customerName,
          signer_email: customerEmail,
          signer_phone: customerPhone,
          signature_image_url: "",
          typed_name: customerName,
          ip_address: ipAddress,
          user_agent: userAgent,
          waiver_text_snapshot: "",
          electronic_consent_text: "",
          event_date: order.event_date || new Date().toISOString().split("T")[0],
          event_address_line1: address?.line1 || "",
          event_city: address?.city || "",
          event_state: address?.state || "",
          event_zip: address?.zip || "",
          ...physicalFields,
        });
      if (insertError) {
        console.error("[upload-physical-waiver] insert error:", insertError.message);
        return jsonError("Failed to record waiver", 500);
      }
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
