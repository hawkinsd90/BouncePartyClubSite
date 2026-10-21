import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { resolveCaller, requireRoles, authFailureResponse, INVOICE_SENDER_ROLES } from '../_shared/auth.ts';
import { generateShortCode, portalTokenFragment } from '../_shared/portal-link.ts';
import { resolveReturnOrigin } from '../_shared/booking/returnOrigin.ts';
import { configuredOrigins } from '../_shared/siteOrigin.ts';
import { storedOrderTotalCents } from '../_shared/booking/orderMoney.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

    // Authorization (Payment Safety A1): this mints invoice credentials for an order and sends email/SMS, so it is
    // staff-only. The public anon key is not enough. Allowed: the backend (service role) and signed-in admin, master or
    // crew (crew may create and send invoices; crew still cannot charge cards or refund elsewhere).
    const caller = await resolveCaller(
      supabase,
      req.headers.get('Authorization'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );
    if (caller.kind !== 'service') {
      const gate = requireRoles(caller, INVOICE_SENDER_ROLES, {
        unauthorized: 'Unauthorized',
        forbidden: 'Forbidden: staff access required.',
      });
      if (!gate.ok) {
        console.warn(`[send-invoice] rejected: caller=${caller.kind}${caller.kind === 'user' ? ` user=${caller.userId}` : ''} reason=staff_required`);
        return authFailureResponse(gate, corsHeaders, 'error-only');
      }
    }

    // The deposit on the invoice link is the order's own required deposit (stored, server-derived), never a figure the caller sends.
    const { orderId, customerEmail, customerPhone, customerName } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const [orderResult, customFeesResult, discountsResult] = await Promise.all([
      supabase.from('orders').select('*, customers(*), addresses(*)').eq('id', orderId).maybeSingle(),
      supabase.from('order_custom_fees').select('amount_cents').eq('order_id', orderId),
      supabase.from('order_discounts').select('amount_cents, percentage').eq('order_id', orderId),
    ]);

    const { data: order, error: orderError } = orderResult;

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The stored order is the snapshot (stored fees are already effective, stored tax is the tax that applies); the total is
    // orderMoney's, the same figure the app and the portal show.
    const orderTotalCents = storedOrderTotalCents(order, discountsResult.data || [], customFeesResult.data || []);
    const depositCents = Number.isFinite(Number(order.deposit_due_cents)) ? Number(order.deposit_due_cents) : 0;

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
        link_type: 'invoice',
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

    // The request's Origin is only a claim: it is used when it is on the allow-list (production site, SITE_URL, RETURN_ORIGINS, local
    // development); otherwise the configured site is used, so an invoice link can never point at a caller-chosen host.
    const resolvedOrigin = resolveReturnOrigin([req.headers.get('origin')], configuredOrigins());

    const fullInvoiceUrl = `${resolvedOrigin}/customer-portal/${orderId}${portalTokenFragment(invoiceLink.link_token)}`;
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
                    <p><strong>Total Amount:</strong> $${(orderTotalCents / 100).toFixed(2)}</p>
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
