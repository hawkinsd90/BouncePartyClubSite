import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface EmailAttachment {
  filename: string;
  content: string;
}

interface EmailRequest {
  to?: string;
  from?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  context?: Record<string, unknown>;
  skipFallback?: boolean;
  templateName?: string;
  orderId?: string;
}

async function sendAdminSMSFallback(
  supabase: SupabaseClient,
  recipient: string,
  subject: string,
  errorMessage: string
) {
  try {
    const { data: adminPhoneSetting } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_notification_phone')
      .maybeSingle();

    const adminPhone = adminPhoneSetting?.value;

    if (!adminPhone) return;

    const smsMessage = `[EMAIL SYSTEM FAILURE]\n\nFailed to send email to: ${recipient}\nSubject: ${subject}\nError: ${errorMessage.substring(0, 100)}\n\nPlease check admin dashboard.`;

    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-sms-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: adminPhone,
        message: smsMessage,
        skipFallback: true,
      }),
    });

    // console.log('Admin SMS fallback sent');
  } catch (err) {
    console.error('Failed to send admin SMS fallback:', err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let body: EmailRequest | null = null;
  let emailTo: string | undefined;
  let emailSubject: string | undefined;
  let emailHtml: string | undefined;
  let emailText: string | undefined;

  try {
    body = await req.json();

    if (!body) {
      return new Response(JSON.stringify({ error: 'Request body is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { to, from, subject, html, text, attachments, context, skipFallback, templateName, orderId } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    emailTo = to;
    emailSubject = subject;
    emailHtml = html;
    emailText = text;

    // If templateName is provided, fetch and populate the template
    if (templateName && orderId) {
      // console.log('[send-email] Looking up template:', templateName);

      const { data: template } = await supabase
        .from('email_templates')
        .select('*')
        .eq('template_name', templateName)
        .maybeSingle();

      if (!template) {
        console.error('[send-email] Template not found:', templateName);
        throw new Error(`Template '${templateName}' not found`);
      }

      const { data: order } = await supabase
        .from('orders')
        .select('*, customers(*)')
        .eq('id', orderId)
        .maybeSingle();

      if (!order) {
        console.error('[send-email] Order not found:', orderId);
        throw new Error(`Order '${orderId}' not found`);
      }

      // Fetch Google review URL if needed
      let reviewUrl = '';
      if (template.content_template.includes('{review_url}')) {
        const { data: reviewUrlSetting } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'google_review_url')
          .maybeSingle();
        reviewUrl = reviewUrlSetting?.value || '';
      }

      // Format order ID
      const formattedOrderId = order.id.toString().padStart(4, '0');

      // Populate template variables
      emailTo = order.customers?.email || to;
      emailSubject = template.subject
        .replace('{order_id}', formattedOrderId)
        .replace('{customer_first_name}', order.customers?.first_name || '')
        .replace('{customer_full_name}', `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`);

      const contentHtml = template.content_template
        .replace(/{customer_first_name}/g, order.customers?.first_name || '')
        .replace(/{customer_full_name}/g, `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`)
        .replace(/{order_id}/g, formattedOrderId)
        .replace(/{event_date}/g, order.event_date || '')
        .replace(/{event_address}/g, order.event_address_line1 || '')
        .replace(/{review_url}/g, reviewUrl);

      // Fetch business info for email wrapper
      const { data: businessSettings } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['business_name', 'business_phone', 'business_email']);

      const businessInfo: Record<string, string> = {};
      businessSettings?.forEach((setting: { key: string; value: string | null }) => {
        if (setting.value) {
          businessInfo[setting.key] = setting.value;
        }
      });

      // Wrap content in email template
      emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center; background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">${template.header_title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px; color: #333333; font-size: 16px; line-height: 1.6;">
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-radius: 0 0 8px 8px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                <strong>${businessInfo.business_name || 'Bounce Party Club'}</strong>
              </p>
              ${businessInfo.business_phone ? `<p style="margin: 0 0 5px 0; color: #6b7280; font-size: 14px;">Phone: ${businessInfo.business_phone}</p>` : ''}
              ${businessInfo.business_email ? `<p style="margin: 0 0 5px 0; color: #6b7280; font-size: 14px;">Email: ${businessInfo.business_email}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      emailText = contentHtml.replace(/<[^>]*>/g, ''); // Strip HTML for plain text version
    }

    const { data: settings } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'resend_api_key')
      .maybeSingle();

    const resendApiKey = settings?.value;

    if (!resendApiKey) {
      const errorMsg = 'Resend API key not configured';

      await supabase.rpc('record_notification_failure', {
        p_type: 'email',
        p_recipient: emailTo || 'unknown',
        p_subject: emailSubject || 'unknown',
        p_message_preview: emailText?.substring(0, 200) || emailHtml?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, emailTo || 'unknown', emailSubject || 'unknown', errorMsg);
      }

      return new Response(
        JSON.stringify({ error: errorMsg }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!emailTo || !emailSubject || (!emailHtml && !emailText)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, and html or text' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const emailPayload: Record<string, unknown> = {
      from: from || 'Bounce Party Club <admin@bouncepartyclub.com>',
      to: [emailTo],
      subject: emailSubject,
    };

    if (emailHtml) emailPayload.html = emailHtml;
    if (emailText) emailPayload.text = emailText;
    if (attachments && attachments.length > 0) emailPayload.attachments = attachments;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);

      const errorMsg = `Resend API error: ${JSON.stringify(resendData)}`;

      await supabase.rpc('record_notification_failure', {
        p_type: 'email',
        p_recipient: emailTo || to || 'unknown',
        p_subject: emailSubject || subject || 'unknown',
        p_message_preview: (emailText || text)?.substring(0, 200) || (emailHtml || html)?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, emailTo || to || 'unknown', emailSubject || subject || 'unknown', errorMsg);
      }

      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: resendData }),
        {
          status: resendResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    await supabase.rpc('record_notification_success', { p_type: 'email' });

    return new Response(
      JSON.stringify({ success: true, messageId: resendData.id }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: unknown) {
    console.error('Error sending email:', error);

    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    const { to, subject, html, text, context, skipFallback } = body || {} as EmailRequest;

    if (to && subject) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      await supabase.rpc('record_notification_failure', {
        p_type: 'email',
        p_recipient: emailTo || to || 'unknown',
        p_subject: emailSubject || subject || 'unknown',
        p_message_preview: (emailText || text)?.substring(0, 200) || (emailHtml || html)?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, emailTo || to || 'unknown', emailSubject || subject || 'unknown', errorMsg);
      }
    }

    return new Response(
      JSON.stringify({ error: errorMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});