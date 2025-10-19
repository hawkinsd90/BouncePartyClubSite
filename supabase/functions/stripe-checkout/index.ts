import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.14.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  orderId: string;
  depositCents: number;
  tipCents?: number;
  customerEmail: string;
  customerName: string;
  redirectBaseUrl?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Handle GET requests for success/cancel pages
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const orderId = url.searchParams.get("orderId");

    if (action === "success") {
      const sessionId = url.searchParams.get("session_id");

      // Update the database immediately when success page loads
      if (orderId && sessionId) {
        try {
          const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          );

          // Get Stripe key from settings
          const { data: stripeKeyData } = await supabaseClient
            .from("admin_settings")
            .select("value")
            .eq("key", "stripe_secret_key")
            .maybeSingle();

          if (stripeKeyData?.value) {
            const stripe = new Stripe(stripeKeyData.value, {
              apiVersion: "2024-10-28.acacia",
            });

            // Retrieve the checkout session to get payment details
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === "paid" && session.payment_intent) {
              // Extract tip from metadata
              const tipCents = parseInt(session.metadata?.tip_cents || '0', 10);
              const paymentAmountCents = (session.amount_total || 0) - tipCents;

              // Update order in database
              await supabaseClient
                .from("orders")
                .update({
                  stripe_payment_status: "paid",
                  stripe_payment_method_id: session.payment_method as string,
                  deposit_paid_cents: paymentAmountCents,
                  tip_cents: tipCents,
                  status: "pending_review",
                })
                .eq("id", orderId);

              // Update payment record
              if (typeof session.payment_intent === 'string') {
                await supabaseClient
                  .from("payments")
                  .update({ status: "succeeded" })
                  .eq("stripe_payment_intent_id", session.payment_intent);
              }

              console.log(`Payment successful for order ${orderId} (Payment: $${paymentAmountCents/100}, Tip: $${tipCents/100})`);
            }
          }
        } catch (error) {
          console.error("Error updating order after payment:", error);
        }
      }

      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <title>Payment Complete</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 400px;
            }
            .checkmark {
              font-size: 4rem;
              color: #10b981;
              margin-bottom: 1rem;
            }
            h1 { color: #1f2937; margin: 0 0 0.5rem 0; }
            p { color: #6b7280; margin: 0 0 1.5rem 0; }
            button {
              background: #667eea;
              color: white;
              border: none;
              padding: 0.75rem 2rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              cursor: pointer;
              font-weight: 600;
            }
            button:hover { background: #5568d3; }
          </style>
          <script>
            // Notify parent window and close
            if (window.opener) {
              window.opener.postMessage({ type: 'PAYMENT_SUCCESS', orderId: '${orderId}' }, '*');
              setTimeout(() => window.close(), 1000);
            } else {
              // If no opener, close after delay
              setTimeout(() => window.close(), 3000);
            }
          </script>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✓</div>
            <h1>Payment Complete!</h1>
            <p>Your payment has been processed successfully.</p>
            <p style="font-size: 0.875rem;">This window will close automatically...</p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
        </html>`,
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    if (action === "cancel") {
      return new Response(
        `<!DOCTYPE html>
        <html>
        <head>
          <title>Payment Canceled</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 400px;
            }
            .icon { font-size: 4rem; margin-bottom: 1rem; }
            h1 { color: #1f2937; margin: 0 0 0.5rem 0; }
            p { color: #6b7280; margin: 0 0 1.5rem 0; }
            button {
              background: #ef4444;
              color: white;
              border: none;
              padding: 0.75rem 2rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              cursor: pointer;
              font-weight: 600;
            }
            button:hover { background: #dc2626; }
          </style>
          <script>
            setTimeout(() => window.close(), 2000);
          </script>
        </head>
        <body>
          <div class="container">
            <div class="icon">✕</div>
            <h1>Payment Canceled</h1>
            <p>Your payment was not completed.</p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
        </html>`,
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }
      );
    }
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Get Stripe key from settings
    const { data: stripeKeyData, error: keyError } = await supabaseClient
      .from("admin_settings")
      .select("value")
      .eq("key", "stripe_secret_key")
      .maybeSingle();

    if (keyError || !stripeKeyData?.value) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured. Please add your Stripe secret key in Admin Settings." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripeKey = stripeKeyData.value;

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-10-28.acacia",
    });

    const { orderId, depositCents, tipCents = 0, customerEmail, customerName, redirectBaseUrl }: CheckoutRequest =
      await req.json();

    if (!orderId || !depositCents || !customerEmail) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Received redirectBaseUrl from frontend:", redirectBaseUrl);
    console.log("Tip amount:", tipCents);

    const totalAmountCents = depositCents + tipCents;

    const { data: order } = await supabaseClient
      .from("orders")
      .select("stripe_customer_id")
      .eq("id", orderId)
      .maybeSingle();

    let customerId = order?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          order_id: orderId,
        },
      });
      customerId = customer.id;

      await supabaseClient
        .from("orders")
        .update({ stripe_customer_id: customerId })
        .eq("id", orderId);
    }

    // Build line items - separate payment and tip
    const lineItems = [
      {
        price_data: {
          currency: "usd",
          unit_amount: depositCents,
          product_data: {
            name: `Payment for Order ${orderId.slice(0, 8).toUpperCase()}`,
            description: "Bounce Party Club rental payment",
          },
        },
        quantity: 1,
      },
    ];

    // Add tip as separate line item if provided
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: lineItems,
      mode: "payment",
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: {
          order_id: orderId,
          payment_type: "deposit",
          tip_cents: tipCents.toString(),
        },
      },
      success_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-checkout?action=success&orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-checkout?action=cancel&orderId=${orderId}`,
      metadata: {
        order_id: orderId,
        tip_cents: tipCents.toString(),
      },
    });

    await supabaseClient.from("payments").insert({
      order_id: orderId,
      stripe_payment_intent_id: session.payment_intent as string,
      amount_cents: depositCents,
      payment_type: "deposit",
      status: "pending",
      description: `Payment for order ${orderId}${tipCents > 0 ? ` (includes $${(tipCents / 100).toFixed(2)} tip)` : ''}`,
    });

    // Update order with tip amount if provided
    if (tipCents > 0) {
      await supabaseClient
        .from("orders")
        .update({ tip_cents: tipCents })
        .eq("id", orderId);
    }

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        customerId: customerId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
