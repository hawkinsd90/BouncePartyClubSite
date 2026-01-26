import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  additionalInfo?: Record<string, any>;
}

const LOGO_URL =
  'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';
const COMPANY_PHONE = '(313) 889-3860';

function createErrorNotificationEmail(errorData: ErrorPayload): string {
  const content = `
    <p style="margin: 0 0 20px; color: #1e293b; font-size: 16px;">An error occurred in the Bounce Party Club application.</p>

    <div style="background-color: #fee2e2; border: 2px solid #ef4444; border-radius: 6px; padding: 20px; margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: #991b1b; font-size: 16px; font-weight: 600;">Error Details</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        <tr>
          <td style="color: #64748b; font-size: 14px;">Message:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-word;">${errorData.message}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">Timestamp:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${errorData.timestamp || new Date().toISOString()}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">URL:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-all;">${errorData.url || 'N/A'}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">User ID:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${errorData.userId || 'Not authenticated'}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">User Agent:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right; word-break: break-all; font-size: 12px;">${errorData.userAgent || 'N/A'}</td>
        </tr>
      </table>
    </div>

    ${errorData.stack ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Stack Trace</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${errorData.stack}</pre>
      </div>
    ` : ''}

    ${errorData.componentStack ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Component Stack</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${errorData.componentStack}</pre>
      </div>
    ` : ''}

    ${errorData.additionalInfo && Object.keys(errorData.additionalInfo).length > 0 ? `
      <div style="margin: 25px 0;">
        <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Additional Information</h3>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #1e293b; line-height: 1.5;">${JSON.stringify(errorData.additionalInfo, null, 2)}</pre>
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
                  <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
                    Bounce Party Club | ${COMPANY_PHONE}
                  </p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                    4426 Woodward St, Wayne, MI 48184
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const errorData: ErrorPayload = await req.json();

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

    const emailSubject = `🚨 Error in Bounce Party Club: ${errorData.message.substring(0, 50)}...`;

    const emailBody = createErrorNotificationEmail(errorData);

    console.log(`Sending error notification to ${adminEmail}`);
    console.log('Error details:', errorData);

    const { data: sendEmailData, error: sendEmailError } = await supabase.functions.invoke(
      'resend',
      {
        body: {
          to: [adminEmail],
          subject: emailSubject,
          html: emailBody,
        },
      }
    );

    if (sendEmailError) {
      console.error('Failed to send error notification email:', sendEmailError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to send email notification',
          details: sendEmailError 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log('Error notification sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Error notification sent' }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error('Error in send-error-notification function:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        message: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});