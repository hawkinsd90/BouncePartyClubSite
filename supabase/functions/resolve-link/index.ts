import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveShortCode } from "../_shared/portal-link.ts";
import { checkRateLimit, createRateLimitResponse, getIdentifier } from "../_shared/rate-limit.ts";

// Public short-link resolver for /i/<shortCode>. A short code is a bearer credential, so this endpoint:
//   - rate-limits by caller IP + endpoint before looking anything up (the caller does not know the order yet);
//   - reads invoice_links with the service role (independent of any anon table policy);
//   - answers only { found: true, orderId, token? } or { found: false }: unknown, malformed, expired and revoked
//     codes are indistinguishable, and nothing else about the order, customer or other links is returned;
//   - never logs the code or the token.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ found: false }, 405);
  }

  try {
    const limit = await checkRateLimit("resolve-link", getIdentifier(req));
    if (!limit.allowed) {
      return createRateLimitResponse(limit, corsHeaders);
    }

    let code: unknown = null;
    try {
      const body = await req.json();
      code = body?.code;
    } catch {
      return json({ found: false });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const resolved = await resolveShortCode(supabase, code);
    if (!resolved) return json({ found: false });

    return json({
      found: true,
      orderId: resolved.orderId,
      ...(resolved.token ? { token: resolved.token } : {}),
    });
  } catch {
    // Same answer as "not found": no detail that helps probing.
    return json({ found: false });
  }
});
