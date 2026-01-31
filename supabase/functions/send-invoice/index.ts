import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

    const { orderId, depositCents, customerEmail, customerPhone, customerName } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get order details
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

    // Create invoice link
    const { data: invoiceLink, error: linkError } = await supabase
      .from('invoice_links')
      .insert({
        order_id: orderId,
        deposit_cents: depositCents || 0,
        customer_filled: customerEmail ? true : false,
      })
      .select()
      .single();

    if (linkError || !invoiceLink) {
      return new Response(
        JSON.stringify({ error: 'Failed to create invoice link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const invoiceUrl = `${req.headers.get('origin')}/invoice/${invoiceLink.link_token}`;

    // Update order with invoice sent timestamp
    await supabase
      .from('orders')
      .update({ invoice_sent_at: new Date().toISOString() })
      .eq('id', orderId);

    // If customer info provided, send email and SMS
    if (customerEmail || customerPhone) {
      const emailPromises = [];
      const smsPromises = [];

      if (customerEmail) {
        emailPromises.push(
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
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
                <p><strong>Total Amount:</strong> $${((order.total_cents || 0) / 100).toFixed(2)}</p>
                <p><strong>Deposit Due:</strong> $${(depositCents / 100).toFixed(2)}</p>
                <p><a href="${invoiceUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;margin:16px 0;">View & Accept Invoice</a></p>
                <p>This link will expire in 7 days.</p>
                <p>Questions? Call us at (313) 889-3860</p>
              `,
            }),
          })
        );
      }

      if (customerPhone) {
        smsPromises.push(
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-sms-notification`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: customerPhone,
              message: `Your Bounce Party Club invoice is ready! View and accept: ${invoiceUrl}`,
            }),
          })
        );
      }

      await Promise.all([...emailPromises, ...smsPromises]);
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoiceUrl,
        linkToken: invoiceLink.link_token,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-invoice:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});