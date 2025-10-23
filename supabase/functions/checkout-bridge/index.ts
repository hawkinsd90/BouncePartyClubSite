/**
 * CHECKOUT BRIDGE PAGE - Supabase Edge Function
 *
 * PURPOSE:
 * This edge function acts as a "bridge" between Stripe and the main application window.
 * After a successful Stripe payment, this page receives the redirect, extracts payment data,
 * sends it back to the original window via postMessage, and closes itself.
 *
 * WHY THIS EXISTS:
 * - Stripe redirects to this page after successful payment (hosted on Supabase domain)
 * - This page is always accessible with no CORS issues (unlike localhost or dev URLs)
 * - It enables communication between Stripe's redirect and your app's main window
 * - Solves the problem of Stripe not being able to redirect to local development URLs
 *
 * FLOW:
 * 1. Stripe redirects here: /checkout-bridge?orderId=xxx&session_id=yyy&origin=zzz
 * 2. Page loads and extracts query parameters
 * 3. JavaScript immediately runs (inline in HTML)
 * 4. postMessage sends payment data to window.opener (the original checkout tab)
 * 5. window.close() attempts to close this tab/window
 * 6. Original tab receives message and navigates to booking confirmation
 *
 * URL PARAMETERS:
 * - orderId: UUID of the order in our database
 * - session_id: Stripe checkout session ID (replaced by Stripe from {CHECKOUT_SESSION_ID})
 * - origin: Target origin for postMessage security (e.g., https://yoursite.com)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  // Parse the URL to extract query parameters sent by Stripe
  const url = new URL(req.url);

  // Extract payment completion data from URL query string
  const orderId = url.searchParams.get("orderId") || "";      // Our internal order UUID
  const sessionId = url.searchParams.get("session_id") || ""; // Stripe's session ID
  const origin = url.searchParams.get("origin") || "*";       // Opener window origin for security

  // Build a minimal HTML page with inline JavaScript
  // This JavaScript runs immediately when the page loads
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Completing...</title></head>
  <body>
    <p>Finishing up… you can close this window.</p>
    <script>
      (function(){
        // Build message object containing payment completion data
        var msg = {
          type: 'BPC_CHECKOUT_COMPLETE',                   // Custom message type for identification
          orderId: ${JSON.stringify(orderId)},             // Order UUID from our database
          session_id: ${JSON.stringify(sessionId)}         // Stripe checkout session ID
        };

        try {
          // Check if this window was opened by another window (window.opener exists)
          // This will be the original checkout page that opened Stripe
          if (window.opener && window.opener.postMessage) {
            // Send the payment data back to the parent window
            // targetOrigin = ${JSON.stringify(origin || "*")} for security
            // Only the specified origin will receive this message
            window.opener.postMessage(msg, ${JSON.stringify(origin || "*")});
          }
        } catch(e) {
          // Silently fail if postMessage doesn't work
          // Browser security settings might block cross-origin messaging in some cases
        }

        try {
          // Attempt to close this window/tab
          // This only works if the window was opened via window.open() (which it was)
          // If it fails, the user sees "you can close this window" message above
          window.close();
        } catch(e) {
          // If close() is blocked by browser, no problem
          // User can manually close or message still got through
        }
      })();
    </script>
  </body>
</html>`;

  // Return the HTML page with appropriate headers
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",  // Serve as HTML
      "cache-control": "no-store"                   // Never cache this page (always fresh data)
    }
  });
});
