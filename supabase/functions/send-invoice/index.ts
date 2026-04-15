import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SHORT_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SHORT_CODE_LENGTH = 8;

function generateShortCode(): string {
  let code = '';
  const bytes = new Uint8Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_CHARS[bytes[i] % SHORT_CODE_CHARS.length];
  }
  return code;
}

async function generateUniqueShortCode(supabase: any): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode();
    const { data: existing } = await supabase
      .from('invoice_links')
      .select('id')
      .eq('short_code', code)
      .maybeSingle();
    if (!existing) return code;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { orderId, depositCents: rawDepositCents, customerEmail, customerPhone, customerName } = await req.json();
    const parsedDepositCents = Number(rawDepositCents);
    const depositCents = Number.isFinite(parsedDepositCents) ? parsedDepositCents : 0;

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, customers(*), addresses(*)')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const shortCode = await generateUniqueShortCode(supabase);

    const eventDate = order.event_date ? new Date(order.event_date) : null;
    const expiresAt = eventDate
      ? new Date(eventDate.getTime() + 3 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const { data: invoiceLink, error: linkError } = await supabase
      .from('invoice_links')
      .insert({
        order_id: orderId,
        deposit_cents: depositCents || 0,
        customer_filled: customerEmail ? true : false,
        expires_at: expiresAt.toISOString(),
        ...(shortCode ? { short_code: shortCode } : {}),
      })
      .select()
      .single();

    if (linkError || !invoiceLink) {
      return new Response(
        JSON.stringify({ error: 'Failed to create invoice link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resolvedOrigin =
      (req.headers.get('origin') && req.headers.get('origin') !== 'null'
        ? req.headers.get('origin')
        : null) ||
      Deno.env.get('SITE_URL') ||
      'https://bouncepartyclub.com';

    const fullInvoiceUrl = `${resolvedOrigin}/customer-portal/${orderId}?t=${invoiceLink.link_token}`;
    const shortInvoiceUrl = shortCode
      ? `${resolvedOrigin}/i/${shortCode}`
      : fullInvoiceUrl;

    await supabase
      .from('orders')
      .update({ invoice_sent_at: new Date().toISOString() })
      .eq('id', orderId);

    if (customerEmail || customerPhone) {
      const notificationTasks: Promise<any>[] = [];

      if (customerEmail) {
        notificationTasks.push(
          (async () => {
            try {
              const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: customerEmail,
                  subject: 'Invoice from Bounce Party Club',
                  html: `
                    <h2>Invoice Ready for Review</h2>
                    <p>Hi ${customerName || 'there'},</p>
                    <p>Your invoice is ready for review and acceptance.</p>
                    <p><strong>Total Amount:</strong> $${(((order.subtotal_cents || 0) + (order.travel_fee_cents || 0) + (order.surface_fee_cents || 0) + (order.generator_fee_cents || 0) + (order.same_day_pickup_fee_cents || 0) + (order.tax_cents || 0)) / 100).toFixed(2)}</p>
                    <p><strong>Deposit Due:</strong> $${(depositCents / 100).toFixed(2)}</p>
                    <p><a href="${shortInvoiceUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;margin:16px 0;">View & Accept Invoice</a></p>
                    <p>Questions? Call us at (313) 889-3860</p>
                  `,
                }),
              });
              if (!res.ok) {
                console.error(`[send-invoice] Email dispatch failed: ${res.status} ${await res.text()}`);
              }
            } catch (err) {
              console.error('[send-invoice] Email dispatch threw:', err);
            }
          })()
        );
      }

      if (customerPhone) {
        notificationTasks.push(
          (async () => {
            try {
              const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-sms-notification`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: customerPhone,
                  message: `Your Bounce Party Club invoice is ready! View and accept: ${shortInvoiceUrl}`,
                }),
              });
              if (!res.ok) {
                console.error(`[send-invoice] SMS dispatch failed: ${res.status} ${await res.text()}`);
              }
            } catch (err) {
              console.error('[send-invoice] SMS dispatch threw:', err);
            }
          })()
        );
      }

      EdgeRuntime.waitUntil(Promise.all(notificationTasks));
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoiceUrl: fullInvoiceUrl,
        shortInvoiceUrl,
        shortCode: shortCode ?? null,
        linkToken: invoiceLink.link_token,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in send-invoice:', error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
