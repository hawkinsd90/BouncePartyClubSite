import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import {
  checkRateLimit,
  createRateLimitResponse,
  getIdentifier,
  buildRateLimitKey,
} from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const LIMITS = {
  name: 200,
  email: 320,
  phone: 30,
  guestCount: 100,
  message: 5000,
};

const RATE_LIMIT_CONFIG = { maxRequests: 3, windowSeconds: 300 };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.substring(0, max) : value;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();

    const name = (body.name ?? '').toString().trim();
    const email = (body.email ?? '').toString().trim();
    const phone = (body.phone ?? '').toString().trim();
    const message = (body.message ?? '').toString().trim();
    const eventDate = body.eventDate ? (body.eventDate ?? '').toString().trim() : '';
    const guestCount = body.guestCount ? (body.guestCount ?? '').toString().trim() : '';

    // --- Validation ---
    if (!name) {
      return new Response(
        JSON.stringify({ error: 'Name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!phone) {
      return new Response(
        JSON.stringify({ error: 'Phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (name.length > LIMITS.name) {
      return new Response(
        JSON.stringify({ error: 'Name is too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (email.length > LIMITS.email) {
      return new Response(
        JSON.stringify({ error: 'Email is too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (phone.length > LIMITS.phone) {
      return new Response(
        JSON.stringify({ error: 'Phone is too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (guestCount.length > LIMITS.guestCount) {
      return new Response(
        JSON.stringify({ error: 'Guest count is too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (message.length > LIMITS.message) {
      return new Response(
        JSON.stringify({ error: 'Message is too long (maximum 5000 characters)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsedEventDate: string | null = null;
    if (eventDate) {
      if (!isValidDate(eventDate)) {
        return new Response(
          JSON.stringify({ error: 'Event date is not a valid date' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      parsedEventDate = eventDate;
    }

    // --- Rate limiting ---
    const ip = getIdentifier(req);
    if (ip) {
      const identifier = buildRateLimitKey(ip, undefined, 'contact-inquiry');
      const rateLimitResult = await checkRateLimit(
        'submit-contact-inquiry',
        identifier,
        RATE_LIMIT_CONFIG
      );

      if (!rateLimitResult.allowed) {
        return createRateLimitResponse(rateLimitResult, corsHeaders);
      }
    }

    // --- Persist inquiry ---
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: inquiry, error: insertError } = await supabase
      .from('contact_inquiries')
      .insert({
        name: truncate(name, LIMITS.name),
        email: truncate(email, LIMITS.email),
        phone: truncate(phone, LIMITS.phone),
        event_date: parsedEventDate,
        guest_count: truncate(guestCount, LIMITS.guestCount),
        message: truncate(message, LIMITS.message),
        email_sent: false,
      })
      .select('id')
      .single();

    if (insertError || !inquiry) {
      console.error('[submit-contact-inquiry] Failed to persist inquiry:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to submit inquiry' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const inquiryId = inquiry.id;

    // --- Attempt admin email notification ---
    try {
      const { data: settingsData } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['admin_email', 'business_email']);

      const settingsMap: Record<string, string> = {};
      settingsData?.forEach((s: { key: string; value: string | null }) => {
        if (s.value) settingsMap[s.key] = s.value;
      });

      const adminEmail = settingsMap['admin_email'] || settingsMap['business_email'];

      if (!adminEmail) {
        console.warn('[submit-contact-inquiry] No admin_email or business_email configured; inquiry saved but no notification sent');
        await supabase.rpc('record_notification_failure', {
          p_type: 'email',
          p_recipient: 'unknown',
          p_subject: 'New Website Inquiry (no destination configured)',
          p_message_preview: `Inquiry from ${name} (${email}) saved but no admin email destination is configured.`,
          p_error: 'No admin_email or business_email configured in admin_settings',
          p_context: { inquiryId },
        });
        return new Response(
          JSON.stringify({ success: true, inquiryId }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safePhone = escapeHtml(phone);
      const safeEventDate = escapeHtml(eventDate || 'Not specified');
      const safeGuestCount = escapeHtml(guestCount || 'Not specified');
      const safeMessage = escapeHtml(message);
      const safeTimestamp = escapeHtml(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Website Inquiry</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
          <tr>
            <td style="background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 2px solid #3b82f6;">
              <h1 style="margin: 0; color: #3b82f6; font-size: 24px; font-weight: bold;">New Website Inquiry</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <table width="100%" cellpadding="8" cellspacing="0" style="color: #1e293b; font-size: 15px; line-height: 1.6;">
                <tr>
                  <td style="color: #64748b; font-size: 14px; width: 160px;">Name:</td>
                  <td style="font-weight: 600;">${safeName}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-size: 14px;">Email:</td>
                  <td style="font-weight: 600;">${safeEmail}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-size: 14px;">Phone:</td>
                  <td style="font-weight: 600;">${safePhone}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-size: 14px;">Event Date:</td>
                  <td style="font-weight: 600;">${safeEventDate}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-size: 14px;">Guest Count:</td>
                  <td style="font-weight: 600;">${safeGuestCount}</td>
                </tr>
                <tr>
                  <td style="color: #64748b; font-size: 14px;">Submitted:</td>
                  <td style="font-weight: 600;">${safeTimestamp}</td>
                </tr>
              </table>

              <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Message</h3>
                <p style="margin: 0; color: #475569; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 2px solid #3b82f6;">
              <p style="margin: 0; color: #64748b; font-size: 13px;">Bounce Party Club | (313) 889-3860</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const emailResponse = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: adminEmail,
            subject: `New Website Inquiry from ${name}`,
            html: emailHtml,
            replyTo: email,
            skipFallback: true,
          }),
        }
      );

      if (emailResponse.ok) {
        const { error: updateError } = await supabase
          .from('contact_inquiries')
          .update({ email_sent: true })
          .eq('id', inquiryId);

        if (updateError) {
          console.error('[submit-contact-inquiry] Email sent but failed to update email_sent flag:', updateError);
        }
      } else {
        console.error('[submit-contact-inquiry] Admin email notification failed:', await emailResponse.text());
      }
    } catch (emailError) {
      console.error('[submit-contact-inquiry] Email notification error (inquiry already saved):', emailError);
    }

    return new Response(
      JSON.stringify({ success: true, inquiryId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('[submit-contact-inquiry] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
