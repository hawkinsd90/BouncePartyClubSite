import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightSync } from "../_shared/cors.ts";

// Source types eligible for promotion
const ELIGIBLE_SOURCE_TYPES = ["lot", "order", "delivery"] as const;
type EligibleSource = typeof ELIGIBLE_SOURCE_TYPES[number];

// Actions supported
type PromoteAction = "unit" | "carousel";

interface PromoteRequest {
  source_type: string;
  source_id: string;         // AdminPhoto.id as stored in the frontend
  action: PromoteAction;
  target_unit_id?: string;   // required when action === 'unit'
  consent_confirmed: boolean;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflightSync(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── 1. Parse and validate request body ──────────────────────────────────
    let body: PromoteRequest;
    try {
      body = await req.json();
    } catch {
      return json400("Invalid JSON body");
    }

    const { source_type, source_id, action, target_unit_id, consent_confirmed } = body;

    if (!source_type || !source_id || !action) {
      return json400("Missing required fields: source_type, source_id, action");
    }

    // ── 2. Consent gate ──────────────────────────────────────────────────────
    if (consent_confirmed !== true) {
      return json400("Marketing consent confirmation is required (consent_confirmed must be true)");
    }

    // ── 3. Validate action ───────────────────────────────────────────────────
    if (action !== "unit" && action !== "carousel") {
      return json400("Invalid action. Must be 'unit' or 'carousel'");
    }
    if (action === "unit" && !target_unit_id) {
      return json400("target_unit_id is required when action is 'unit'");
    }

    // ── 4. Block ineligible source types ────────────────────────────────────
    if (!ELIGIBLE_SOURCE_TYPES.includes(source_type as EligibleSource)) {
      return json400(
        `Source type '${source_type}' is not eligible for promotion. ` +
        `Eligible types: ${ELIGIBLE_SOURCE_TYPES.join(", ")}. ` +
        `damage, unit, and carousel photos cannot be promoted.`
      );
    }

    // ── 5. Build clients ─────────────────────────────────────────────────────
    // Caller client — used ONLY for role verification via auth.uid()
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json401("Missing Authorization header");

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Service-role client — used for all DB reads/writes and storage ops
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── 6. Verify caller role ────────────────────────────────────────────────
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json401("Not authenticated");

    const { data: roleData, error: roleErr } = await callerClient.rpc("get_user_role", {
      user_id_input: user.id,
    });
    if (roleErr) {
      return jsonError(500, `Role check failed: ${roleErr.message}`);
    }
    const role = roleData as string | null;
    if (role !== "admin" && role !== "master") {
      return json403("admin or master role required to promote media");
    }

    // ── 7. Resolve source photo from DB ─────────────────────────────────────
    let sourceBucket: string;
    let sourceStoragePath: string;
    let derivedFileName: string;

    if (source_type === "lot") {
      // source_id is the order_lot_pictures.id (UUID)
      const { data: row, error } = await adminClient
        .from("order_lot_pictures")
        .select("id, file_path, file_name")
        .eq("id", source_id)
        .maybeSingle();

      if (error) return jsonError(500, `DB lookup failed: ${error.message}`);
      if (!row) return json400(`Lot photo not found: ${source_id}`);

      sourceBucket = "lot-pictures";
      sourceStoragePath = row.file_path;
      derivedFileName = row.file_name ?? row.file_path.split("/").pop() ?? "lot-photo.jpg";

    } else if (source_type === "order") {
      // source_id is the order_pictures.id (UUID)
      const { data: row, error } = await adminClient
        .from("order_pictures")
        .select("id, file_path, file_name")
        .eq("id", source_id)
        .maybeSingle();

      if (error) return jsonError(500, `DB lookup failed: ${error.message}`);
      if (!row) return json400(`Order photo not found: ${source_id}`);

      sourceBucket = "order-pictures";
      sourceStoragePath = row.file_path;
      derivedFileName = row.file_name ?? row.file_path.split("/").pop() ?? "order-photo.jpg";

    } else {
      // source_type === "delivery"
      // Delivery photos are stored as full public URLs inside task_status.delivery_images[].
      // source_id is the synthetic ID built in useAdminPhotos: "delivery-{task_status_id}-{url_suffix}"
      // We must re-verify the URL exists in the DB rather than trusting the URL directly.

      // Parse task_status_id out of the synthetic ID
      // Format: "delivery-{task_status_id}-{last_16_chars_of_url}"
      const deliveryIdParts = source_id.match(/^delivery-([0-9a-f-]{36})-(.+)$/);
      if (!deliveryIdParts) {
        return json400("Invalid delivery photo source_id format");
      }
      const taskStatusId = deliveryIdParts[1];
      const urlSuffix = deliveryIdParts[2];

      const { data: tsRow, error: tsErr } = await adminClient
        .from("task_status")
        .select("id, delivery_images")
        .eq("id", taskStatusId)
        .maybeSingle();

      if (tsErr) return jsonError(500, `DB lookup failed: ${tsErr.message}`);
      if (!tsRow) return json400(`Task status not found: ${taskStatusId}`);

      const deliveryImages: string[] = tsRow.delivery_images ?? [];
      const verifiedUrl = deliveryImages.find(
        (url) => typeof url === "string" && url.slice(-16) === urlSuffix
      );

      if (!verifiedUrl) {
        return json400("Delivery photo not found in task_status.delivery_images — cannot promote arbitrary URLs");
      }

      // Extract storage path from verified public URL
      const marker = "/public/public-assets/";
      const markerIdx = verifiedUrl.indexOf(marker);
      if (markerIdx < 0) {
        return json400("Could not extract storage path from verified delivery photo URL");
      }
      sourceStoragePath = verifiedUrl.slice(markerIdx + marker.length);
      sourceBucket = "public-assets";
      derivedFileName = sourceStoragePath.split("/").pop() ?? "delivery-photo.jpg";
    }

    // ── 8. Download source file ──────────────────────────────────────────────
    const { data: fileBlob, error: downloadErr } = await adminClient.storage
      .from(sourceBucket)
      .download(sourceStoragePath);

    if (downloadErr || !fileBlob) {
      return jsonError(500, `Failed to download source file: ${downloadErr?.message ?? "empty blob"}`);
    }

    // ── 9. Determine destination and upload ─────────────────────────────────
    const timestamp = Date.now();
    const ext = derivedFileName.split(".").pop() ?? "jpg";
    const safeBaseName = derivedFileName.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);

    if (action === "unit") {
      // Validate target unit exists
      const { data: unitRow, error: unitErr } = await adminClient
        .from("units")
        .select("id, name")
        .eq("id", target_unit_id!)
        .maybeSingle();

      if (unitErr) return jsonError(500, `Unit lookup failed: ${unitErr.message}`);
      if (!unitRow) return json400(`Unit not found: ${target_unit_id}`);

      // Upload to unit-images
      const destPath = `promoted/${safeBaseName}-${timestamp}.${ext}`;
      const { error: uploadErr } = await adminClient.storage
        .from("unit-images")
        .upload(destPath, fileBlob, {
          contentType: fileBlob.type || "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        return jsonError(500, `Upload to unit-images failed: ${uploadErr.message}`);
      }

      // Build public URL
      const { data: pubUrlData } = adminClient.storage
        .from("unit-images")
        .getPublicUrl(destPath);
      const publicUrl = pubUrlData.publicUrl;

      // Determine sort order — append after existing
      const { data: sortRows } = await adminClient
        .from("unit_media")
        .select("sort")
        .eq("unit_id", target_unit_id!)
        .order("sort", { ascending: false })
        .limit(1);
      const maxSort = sortRows?.[0]?.sort ?? -1;

      // Insert unit_media row
      const { data: insertedRow, error: insertErr } = await adminClient
        .from("unit_media")
        .insert({
          unit_id: target_unit_id,
          url: publicUrl,
          alt: `${unitRow.name} - ${derivedFileName}`,
          mode: "dry",
          visibility_mode: "dry",
          sort: maxSort + 1,
          is_featured: false,
        })
        .select("id")
        .single();

      if (insertErr) {
        // Upload succeeded but insert failed — report clearly, do not silently swallow
        return jsonError(500,
          `File uploaded to unit-images (${destPath}) but unit_media insert failed: ${insertErr.message}. ` +
          `Manual cleanup may be needed for path: ${destPath}`
        );
      }

      return jsonOk({
        success: true,
        action: "unit",
        unit_media_id: insertedRow.id,
        public_url: publicUrl,
        storage_path: destPath,
        unit_id: target_unit_id,
        unit_name: unitRow.name,
      });

    } else {
      // action === "carousel"

      // Upload to carousel-media
      const destPath = `promoted/${safeBaseName}-${timestamp}.${ext}`;
      const { error: uploadErr } = await adminClient.storage
        .from("carousel-media")
        .upload(destPath, fileBlob, {
          contentType: fileBlob.type || "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        return jsonError(500, `Upload to carousel-media failed: ${uploadErr.message}`);
      }

      // Build public URL
      const { data: pubUrlData } = adminClient.storage
        .from("carousel-media")
        .getPublicUrl(destPath);
      const publicUrl = pubUrlData.publicUrl;

      // Determine display_order — append after existing
      const { data: orderRows } = await adminClient
        .from("hero_carousel_images")
        .select("display_order")
        .order("display_order", { ascending: false })
        .limit(1);
      const maxOrder = orderRows?.[0]?.display_order ?? 0;

      // Insert hero_carousel_images row
      const { data: insertedRow, error: insertErr } = await adminClient
        .from("hero_carousel_images")
        .insert({
          image_url: publicUrl,
          storage_path: destPath,
          media_type: "image",
          is_active: true,
          display_order: maxOrder + 1,
          title: null,
          description: null,
        })
        .select("id")
        .single();

      if (insertErr) {
        return jsonError(500,
          `File uploaded to carousel-media (${destPath}) but hero_carousel_images insert failed: ${insertErr.message}. ` +
          `Manual cleanup may be needed for path: ${destPath}`
        );
      }

      return jsonOk({
        success: true,
        action: "carousel",
        carousel_image_id: insertedRow.id,
        public_url: publicUrl,
        storage_path: destPath,
        display_order: maxOrder + 1,
      });
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, `Unexpected error: ${message}`);
  }
});

// ── Response helpers ─────────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function json400(msg: string): Response {
  return jsonError(400, msg);
}

function json401(msg: string): Response {
  return jsonError(401, msg);
}

function json403(msg: string): Response {
  return jsonError(403, msg);
}

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
