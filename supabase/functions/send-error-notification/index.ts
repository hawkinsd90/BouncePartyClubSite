import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkRateLimit, createRateLimitResponse, getIdentifier, buildRateLimitKey } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  userAgent?: string;
  url?: string;
  timestamp?: string;
  userId?: string;
  additionalInfo?: Record<string, unknown>;
}

const LOGO_URL =
  'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';
const COMPANY_PHONE = '(313) 889-3860';

// This endpoint is public by design (the browser reports its own crashes with only the anon key), so every field is untrusted: each one
// is length-capped, and HTML-escaped wherever it is placed in the email, so a caller cannot inject markup or links into the message the
// administrator receives. Requests are rate-limited per request address with a ceiling on the total.
const MAX_MESSAGE = 500;
const MAX_STACK = 6000;
const MAX_SHORT = 500;
const MAX_INFO = 4000;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

// Returns null when the body is not a usable report (no message).
function sanitizeErrorPayload(raw: unknown): ErrorPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const message = clip(r.message, MAX_MESSAGE);
  if (!message) return null;
  let additionalInfo: Record<string, unknown> | undefined;
  if (r.additionalInfo && typeof r.additionalInfo === "object" && !Array.isArray(r.additionalInfo)) {
    let json = "";
    try {
      json = JSON.stringify(r.additionalInfo);
    } catch {
      json = "";
    }
    additionalInfo = json && json.length <= MAX_INFO ? (r.additionalInfo as Record<string, unknown>) : { note: "additional information omitted (too large or not serializable)" };
  }
  return {
    message,
    stack: clip(r.stack, MAX_STACK),
    componentStack: clip(r.componentStack, MAX_STACK),
    userAgent: clip(r.userAgent, MAX_SHORT),
    url: clip(r.url, MAX_SHORT),
    // The report time is the server's, never the caller's.
    timestamp: new Date().toISOString(),
    userId: clip(r.userId, 100),
    additionalInfo,
  };
}

function createErrorNotificationEmail(errorData: ErrorPayload): string {
  const content = `
    <p style="margin: 0 0 20px; color: #1e293b; font-size: 16px;">An error occurred in the Bounce Party Club application.</p>

    <div style="background-color: #fee2e2; border: 2px solid #ef4444; border-radius: 6px; padding: 20px; margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: #991b1b; font-size: 16px; font-weight: 600;">Error Details</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        <tr>
          <td style="color: #64748b; font-size: 14px;">Message:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-word;">${escapeHtml(errorData.message)}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">Timestamp:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${escapeHtml(errorData.timestamp || new Date().toISOString())}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">URL:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-all;">${escapeHtml(errorData.url || 'N/A')}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">User ID:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${escapeHtml(errorData.userId || 'Not authenticated')}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">User Agent:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-all; font-size: 12px;">${escapeHtml(errorData.userAgent || 'N/A')}</td>
        </tr>
      </table>
    </div>

    ${errorData.stack ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Stack Trace</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${escapeHtml(errorData.stack)}</pre>
      </div>
    ` : ''}

    ${errorData.componentStack ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Component Stack</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${escapeHtml(errorData.componentStack)}</pre>
      </div>
    ` : ''}

    ${errorData.additionalInfo && Object.keys(errorData.additionalInfo).length > 0 ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Additional Information</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${escapeHtml(JSON.stringify(errorData.additionalInfo, null, 2))}</pre>
      </div>
    ` : ''}

    <p style="margin: 25px 0 0; color: #64748b; font-size: 13px; font-style: italic;">
      This is an automated error notification from Bounce Party Club.
    </p>
  `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error Notification</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #ef4444;">
              <tr>
                <td style="background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 2px solid #ef4444;">
                  <img src="${LOGO_URL}" alt="Bounce Party Club" style="height: 80px; width: auto;" />
                  <h1 style="margin: 15px 0 0; color: #ef4444; font-size: 24px; font-weight: bold;">🚨 Error Report</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 2px solid #ef4444;">
                  <p style="margin: 0; color: #64748b; font-size: 13px;">
                    Bounce Party Club | ${COMPANY_PHONE}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Public endpoint: throttle before reading the body or touching the database. The identifier is the request address; the global
    // bucket bounds the total even if the address could be rotated. Anything the limiter cannot decide is dropped, not sent.
    const ip = getIdentifier(req);
    const perAddress = await checkRateLimit("send-error-notification", buildRateLimitKey(ip, undefined, "send-error-notification"), undefined, false, true);
    if (!perAddress.allowed) return createRateLimitResponse(perAddress, corsHeaders);
    const overall = await checkRateLimit("send-error-notification-global", "send-error-notification-global", undefined, false, true);
    if (!overall.allowed) return createRateLimitResponse(overall, corsHeaders);

    let rawBody: unknown = null;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = null;
    }
    const errorData = sanitizeErrorPayload(rawBody);
    if (!errorData) {
      return new Response(
        JSON.stringify({ success: false, error: "A report needs a message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: adminEmailData } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "admin_email")
      .maybeSingle();

    if (!adminEmailData?.value) {
      console.error("Admin email not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Admin email not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const adminEmail = adminEmailData.value;

    const subjectText = errorData.message.replace(new RegExp("[" + String.fromCharCode(13, 10) + "]+", "g"), " ").substring(0, 50);
    const emailSubject = `🚨 Error in Bounce Party Club: ${subjectText}...`;

    const emailBody = createErrorNotificationEmail(errorData);

    // console.log(`Sending error notification to ${adminEmail}`);
    // console.log('Error details:', errorData);

    // Sent through the guarded email relay (the old call named a function called "resend", which does not exist, so no report was ever
    // emailed). This client holds the service-role key, which the relay accepts from trusted functions. skipFallback: a failing report
    // must not turn into an SMS to the owner for every browser error.
    const { error: sendEmailError } = await supabase.functions.invoke(
      'send-email',
      {
        body: {
          to: adminEmail,
          subject: emailSubject,
          html: emailBody,
          skipFallback: true,
        },
      }
    );

    if (sendEmailError) {
      console.error('Failed to send error notification email:', sendEmailError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to send email notification' }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // console.log('Error notification sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Error notification sent' }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error('Error in send-error-notification function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});