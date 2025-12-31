import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface EmailRequest {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  context?: any;
  skipFallback?: boolean;
}

async function sendAdminSMSFallback(
  supabase: any,
  recipient: string,
  subject: string,
  errorMessage: string
) {
  try {
    const { data: adminSettings } = await supabase
      .from('admin_settings')
      .select('key, value')
      .in('key', ['admin_notification_phone', 'twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number'])
      .order('key');

    const settingsMap = new Map(adminSettings?.map((s: any) => [s.key, s.value]));
    const adminPhone = settingsMap.get('admin_notification_phone');

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

    console.log('Admin SMS fallback sent');
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

  try {
    body = await req.json();
    const { to, from, subject, html, text, context, skipFallback } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
        p_recipient: to,
        p_subject: subject,
        p_message_preview: text?.substring(0, 200) || html?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, to, subject, errorMsg);
      }

      return new Response(
        JSON.stringify({ error: errorMsg }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!to || !subject || (!html && !text)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, and html or text' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const emailPayload: any = {
      from: from || 'Bounce Party Club <admin@bouncepartyclub.com>',
      to: [to],
      subject,
    };

    if (html) emailPayload.html = html;
    if (text) emailPayload.text = text;

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
        p_recipient: to,
        p_subject: subject,
        p_message_preview: text?.substring(0, 200) || html?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, to, subject, errorMsg);
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
  } catch (error: any) {
    console.error('Error sending email:', error);

    const errorMsg = error.message || 'Internal server error';
    const { to, subject, html, text, context, skipFallback } = body || {} as EmailRequest;

    if (to && subject) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      await supabase.rpc('record_notification_failure', {
        p_type: 'email',
        p_recipient: to,
        p_subject: subject,
        p_message_preview: text?.substring(0, 200) || html?.substring(0, 200) || null,
        p_error: errorMsg,
        p_context: context || {}
      });

      if (!skipFallback) {
        await sendAdminSMSFallback(supabase, to, subject, errorMsg);
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