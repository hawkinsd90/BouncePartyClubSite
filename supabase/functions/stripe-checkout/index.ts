/**
 * STRIPE CHECKOUT - Supabase Edge Function
 *
 * PURPOSE:
 * Creates Stripe Checkout sessions for customer payments. This is the main payment
 * processing function that handles both creating new checkout sessions and checking
 * payment status via webhook-style polling.
 *
 * MAIN RESPONSIBILITIES:
 * 1. Create Stripe Checkout sessions with line items (deposit + optional tip)
 * 2. Manage Stripe customers (create or reuse existing)
 * 3. Build success/cancel URLs for post-payment redirects
 * 4. Handle payment status checks via GET requests (polling endpoint)
 * 5. Update order and payment records in database when payment completes
 *
 * REQUEST TYPES:
 * - POST: Create new Stripe Checkout session (primary use)
 * - GET: Check payment status (webhook-style, used by polling)
 * - OPTIONS: CORS preflight (browsers send this automatically)
 *
 * SUCCESS URL FLOW:
 * After payment, Stripe redirects to checkout-bridge function (Supabase domain)
 * Bridge function posts message back to main window and closes itself
 * Main window then navigates to booking-confirmed.html
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

// CORS headers - allows frontend to call this function from any origin
// Required for browser security when making cross-origin requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// TypeScript interface defining the expected request body structure
// This ensures type safety and documents what data the frontend must send
interface CheckoutRequest {
  orderId: string;              // UUID of the order in our database
  depositCents: number;         // Amount to charge in cents (e.g., 5000 = $50.00)
  tipCents?: number;           // Optional tip amount in cents
  customerEmail: string;       // Customer's email for Stripe customer creation
  customerName: string;        // Customer's full name for Stripe
  appBaseUrl?: string;         // DEPRECATED - no longer used
  origin?: string;             // Frontend origin URL (e.g., https://yoursite.com or http://localhost:3000)
}

Deno.serve(async (req: Request) => {
  // =====================================================
  // HANDLE CORS PREFLIGHT (OPTIONS)
  // =====================================================
  // Browsers automatically send OPTIONS requests before POST/GET
  // to check if cross-origin requests are allowed
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    // =====================================================
    // HANDLE PAYMENT STATUS CHECKS (GET)
    // =====================================================
    // GET requests are used to check if a payment has completed
    // This is called by the frontend polling mechanism as a backup
    // to the postMessage flow from the bridge page
    if (req.method === "GET") {
      // Parse query parameters from the URL
      const url = new URL(req.url);
      const action = url.searchParams.get("action");         // e.g., "webhook"
      const orderId = url.searchParams.get("orderId");       // Our order UUID
      const sessionId = url.searchParams.get("session_id"); // Stripe session ID

      // If this is a webhook-style check with required parameters
      if (action === "webhook" && orderId && sessionId) {
        try {
          // Create Supabase client with SERVICE ROLE KEY (admin access)
          // This has full permissions to read/write all data
          const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
          );

          // Retrieve Stripe secret key from database
          // This is stored securely in admin_settings table
          const { data: stripeKeyData } = await supabaseClient
            .from("admin_settings")
            .select("value")
            .eq("key", "stripe_secret_key")
            .maybeSingle(); // Returns null if not found (not an error)

          if (stripeKeyData?.value) {
            // Initialize Stripe SDK with secret key
            const stripe = new Stripe(stripeKeyData.value, {
              apiVersion: "2024-10-28.acacia", // Use specific API version for consistency
            });

            // Retrieve the checkout session from Stripe to check status
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            // If payment was successful and we have a payment intent
            if (session.payment_status === "paid" && session.payment_intent) {
              // Extract tip amount from session metadata (stored when session was created)
              const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);

              // Calculate actual payment amount (total minus tip)
              // We store these separately for accounting purposes
              const paymentAmountCents = (session.amount_total || 0) - tipCents;

              // Update the order record with payment information
              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_status: "paid",                                  // Mark payment as complete
                  stripe_payment_method_id: session.payment_method as string,    // Store payment method ID
                  deposit_paid_cents: paymentAmountCents,                        // Record amount paid
                  status: "pending_review",                                       // Move to next workflow stage
                })
                .eq("id", orderId);

              // Update the payment record status
              // payment_intent can be either a string ID or a PaymentIntent object
              if (typeof session.payment_intent === "string") {
                await supabaseClient
                  .from("payments")
                  .update({ status: "succeeded" })
                  .eq("stripe_payment_intent_id", session.payment_intent);
              }

              console.log(`Payment successful for order ${orderId}`);
            }
          }
        } catch (error) {
          console.error("Error updating order:", error);
          // Silently fail - don't return error to prevent exposing internals
        }
      }

      // Return success response for GET requests
      return new Response(
        JSON.stringify({ success: true, action, orderId }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // =====================================================
    // CREATE STRIPE CHECKOUT SESSION (POST)
    // =====================================================
    // This is the main flow - creating a new checkout session

    // Create Supabase client with service role key for database access
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Retrieve Stripe secret key from database
    // Must be configured in admin_settings table before payments work
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    // If Stripe is not configured, cannot proceed with payment
    if (keyError || !stripeKeyData?.value) {
      return new Response(JSON.stringify({ error: "Stripe not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Stripe SDK with the secret key from database
    const stripe = new Stripe(stripeKeyData.value, {
      apiVersion: "2024-10-28.acacia",
    });

    // Parse the request body to get payment details
    const body: CheckoutRequest = await req.json();
    const { orderId, depositCents, tipCents = 0, customerEmail, customerName, origin: openerOrigin } = body;

    // Validate required fields
    if (!orderId || !depositCents || !customerEmail) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================
    // DETERMINE REDIRECT URLs
    // =====================================================

    // Get THIS function's origin (Supabase functions domain)
    // This is always a publicly accessible URL (no localhost issues)
    const functionOrigin = new URL(req.url).origin;

    // Determine the site origin for cancel URL (back to checkout page)
    // Try multiple sources in order of preference:
    // 1. openerOrigin from request body (most reliable)
    // 2. Origin header from the request
    // 3. Referer header parsed for origin
    // 4. Fallback to localhost for local development
    const headerOrigin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    let siteOrigin = openerOrigin || headerOrigin;
    if (!siteOrigin && referer) {
      try {
        siteOrigin = new URL(referer).origin;
      } catch {}
    }
    siteOrigin = siteOrigin || 'http://localhost:3000'; // Final fallback

    // =====================================================
    // GET OR CREATE STRIPE CUSTOMER
    // =====================================================
    // Reusing customers allows us to save payment methods for future use

    // Check if this order already has a Stripe customer associated
    const { data: order } = await supabaseClient
      .from("orders")
      .select("stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    let customerId = order?.stripe_customer_id || null;

    // If no existing customer, create a new one in Stripe
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: { order_id: orderId }, // Link back to our order for reference
      });
      customerId = customer.id;

      // Save the Stripe customer ID to our database for future use
      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // =====================================================
    // BUILD LINE ITEMS FOR CHECKOUT
    // =====================================================
    // Line items are what the customer sees in Stripe Checkout

    // Start with the main payment (deposit or full amount)
    const lineItems = [
      {
        price_data: {
          currency: "usd",                                                    // USD currency
          unit_amount: depositCents,                                          // Amount in cents
          product_data: {
            name: `Payment for Order ${orderId.slice(0, 8).toUpperCase()}`,  // Short order ID
            description: "Bounce Party Club rental payment",
          },
        },
        quantity: 1,
      },
    ];

    // Add tip as a separate line item if customer provided one
    // This keeps tip separate in Stripe for reporting/accounting
    if (tipCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: tipCents,
          product_data: {
            name: "Tip for Crew",
            description: "Gratuity for service",
          },
        },
        quantity: 1,
      });
    }

    // =====================================================
    // BUILD SUCCESS AND CANCEL URLs
    // =====================================================

    // SUCCESS URL: Redirect to bridge page (on Supabase domain)
    // The bridge page will postMessage back to opener and close itself
    // {CHECKOUT_SESSION_ID} is a Stripe placeholder that gets replaced with actual session ID
    const success_url = `${functionOrigin}/functions/v1/checkout-bridge?orderId=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}&origin=${encodeURIComponent(openerOrigin || "")}`;

    // CANCEL URL: Go back to checkout page on the main site
    const cancel_url = `${siteOrigin}/checkout?canceled=1&orderId=${encodeURIComponent(orderId)}`;

    // =====================================================
    // CREATE STRIPE CHECKOUT SESSION
    // =====================================================

    const session = await stripe.checkout.sessions.create({
      customer: customerId,                                 // Link to existing/new customer
      line_items: lineItems,                               // What they're paying for
      mode: "payment",                                     // One-time payment (not subscription)
      payment_intent_data: {
        setup_future_usage: "off_session",                 // Save payment method for future charges
        metadata: {                                         // Custom data attached to payment intent
          order_id: orderId,
          payment_type: "deposit",
          tip_cents: tipCents.toString(),
        },
      },
      success_url,                                          // Where to go after successful payment
      cancel_url,                                           // Where to go if user cancels
      metadata: {                                           // Custom data attached to session
        order_id: orderId,
        tip_cents: tipCents.toString(),                    // Store tip separately for accounting
      },
    });

    // Log for debugging purposes
    console.log("🎯 [STRIPE-CHECKOUT] Session created successfully!");
    console.log("🎯 [STRIPE-CHECKOUT] Session ID:", session.id);
    console.log("🎯 [STRIPE-CHECKOUT] Success URL:", success_url);
    console.log("🎯 [STRIPE-CHECKOUT] Cancel URL:", cancel_url);

    // =====================================================
    // CREATE PAYMENT RECORD IN DATABASE
    // =====================================================
    // Track this payment attempt in our system
    // Status starts as "pending" and will be updated to "succeeded" after payment

    await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: session.payment_intent as string, // Link to Stripe payment
      amount_cents: depositCents,                                  // Amount being charged
      payment_type: "deposit",                                     // Type of payment
      status: "pending",                                           // Initial status
      description: `Payment for order ${orderId}${tipCents > 0 ? ` (includes $${(tipCents / 100).toFixed(2)} tip)` : ""}`,
    });

    // =====================================================
    // RETURN SESSION DATA TO FRONTEND
    // =====================================================
    // Frontend will use session.url to open Stripe Checkout in a new window

    return new Response(
      JSON.stringify({
        sessionId: session.id,        // Stripe session ID for reference
        url: session.url,             // URL to open Stripe Checkout (what frontend needs)
        customerId: customerId,       // Stripe customer ID
        successUrl: session.success_url, // For debugging/verification
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    // Log error details for debugging
    console.error("Stripe checkout error:", error);

    // Return error to frontend
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
