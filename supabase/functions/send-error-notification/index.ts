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
    
    const emailBody = `
      <h2>Error Report from Bounce Party Club</h2>
      <hr>
      
      <h3>Error Details</h3>
      <p><strong>Message:</strong> ${errorData.message}</p>
      <p><strong>Timestamp:</strong> ${errorData.timestamp || new Date().toISOString()}</p>
      <p><strong>URL:</strong> ${errorData.url || 'N/A'}</p>
      <p><strong>User ID:</strong> ${errorData.userId || 'Not authenticated'}</p>
      
      ${errorData.stack ? `
        <h3>Stack Trace</h3>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${errorData.stack}</pre>
      ` : ''}
      
      ${errorData.componentStack ? `
        <h3>Component Stack</h3>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${errorData.componentStack}</pre>
      ` : ''}
      
      <h3>Environment</h3>
      <p><strong>User Agent:</strong> ${errorData.userAgent || 'N/A'}</p>
      
      ${errorData.additionalInfo && Object.keys(errorData.additionalInfo).length > 0 ? `
        <h3>Additional Information</h3>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${JSON.stringify(errorData.additionalInfo, null, 2)}</pre>
      ` : ''}
      
      <hr>
      <p style="color: #666; font-size: 12px;">This is an automated error notification from Bounce Party Club.</p>
    `;

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