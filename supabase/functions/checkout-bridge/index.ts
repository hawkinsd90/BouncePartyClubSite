/** supabase/functions/checkout-bridge/index.ts */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId") || "";
  const sessionId = url.searchParams.get("session_id") || "";
  const origin = url.searchParams.get("origin") || "*";

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Completing...</title></head>
  <body>
    <p>Finishing up… you can close this window.</p>
    <script>
      (function(){
        var msg = { type: 'BPC_CHECKOUT_COMPLETE', orderId: ${JSON.stringify(orderId)}, session_id: ${JSON.stringify(sessionId)} };
        try {
          if (window.opener && window.opener.postMessage) {
            window.opener.postMessage(msg, ${JSON.stringify(origin || "*")});
          }
        } catch(e) {}
        try { window.close(); } catch(e) {}
      })();
    </script>
  </body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
});
