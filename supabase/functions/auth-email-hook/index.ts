/*
  DEPRECATED - auth-email-hook

  This edge function was previously used to intercept Supabase Auth emails
  (signup confirmation, password reset) and send them via Resend.

  It is NO LONGER part of the active architecture.

  Current architecture (as of 2026-03-16):
    - Supabase Auth sends all auth emails directly via its own built-in email system
    - No Send Email hook is active in Authentication > Hooks
    - Templates are customized directly in Supabase Dashboard > Authentication > Email Templates

  DO NOT re-enable this function as a Send Email hook target. If you do, Supabase
  will attempt to call it and auth emails will fail unless SEND_EMAIL_HOOK_SECRET
  and RESEND_API_KEY are still configured as edge function secrets.

  Business/app emails (orders, invoices, admin notifications) continue to use
  the send-email edge function and are NOT affected by this deprecation.
*/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: 'This endpoint is deprecated. Auth emails are handled by Supabase default sending.',
      deprecated: true,
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
