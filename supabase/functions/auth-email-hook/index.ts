const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
    if (hookSecret) {
      const authHeader = req.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== hookSecret) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: invalid or missing hook secret' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const event = await req.json();

    const emailType: string = event?.email_action_type ?? '';
    const recipient: string = event?.user?.email ?? '';
    const confirmUrl: string = event?.email_data?.confirmation_url ?? '';

    if (!recipient) {
      return new Response(
        JSON.stringify({ error: 'No recipient email in hook payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('[auth-email-hook] RESEND_API_KEY secret not set');
      return new Response(
        JSON.stringify({ error: 'Email service not configured: RESEND_API_KEY missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let subject = '';
    let html = '';

    if (emailType === 'signup' || emailType === 'email_change_new') {
      subject = 'Confirm your Bounce Party Club account';
      html = buildSignupEmail(confirmUrl);
    } else if (emailType === 'recovery') {
      subject = 'Reset your Bounce Party Club password';
      html = buildRecoveryEmail(confirmUrl);
    } else {
      console.log('[auth-email-hook] Unhandled email type, skipping:', emailType);
      return new Response(
        JSON.stringify({ message: 'Unhandled email type, skipping', emailType }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Bounce Party Club <admin@bouncepartyclub.com>',
        to: [recipient],
        subject,
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[auth-email-hook] Resend error:', resendData);
      return new Response(
        JSON.stringify({ error: 'Failed to send email via Resend', details: resendData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[auth-email-hook] Email sent successfully:', { recipient, emailType, id: resendData.id });
    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[auth-email-hook] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildSignupEmail(confirmUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Confirm Your Bounce Party Club Account</title>
</head>
<body style="margin:0;padding:0;background:#fff8f0;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr>
<td style="background:#f97316;padding:32px 40px;text-align:center;">
<img src="https://bouncepartyclub.com/bounce%20party%20club%20logo.png" alt="Bounce Party Club" style="height:72px;width:auto;display:block;margin:0 auto 12px;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Bounce Party Club</h1>
<p style="margin:6px 0 0;color:#fed7aa;font-size:14px;">Southeast Michigan's #1 Inflatable Rental Company</p>
</td>
</tr>
<tr>
<td style="padding:40px 40px 32px;">
<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;font-weight:700;">Confirm Your Account</h2>
<p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">Thanks for signing up! Click the button below to verify your email address and get access to your Bounce Party Club account.</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
<tr>
<td style="background:#f97316;border-radius:8px;text-align:center;">
<a href="${confirmUrl}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Confirm My Email</a>
</td>
</tr>
</table>
<p style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-align:center;">Or copy and paste this link into your browser:</p>
<p style="margin:0 0 32px;font-size:12px;color:#64748b;text-align:center;word-break:break-all;">${confirmUrl}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">
<p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">If you didn't create an account with Bounce Party Club, you can safely ignore this email. This link expires in 24 hours.</p>
</td>
</tr>
<tr>
<td style="background:#fff8f0;padding:24px 40px;text-align:center;border-top:1px solid #fed7aa;">
<p style="margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600;">Bounce Party Club</p>
<p style="margin:0 0 4px;font-size:12px;color:#b45309;">Southeast Michigan's Inflatable Rental Experts</p>
<p style="margin:0;font-size:12px;color:#b45309;">(313) 889-3860 &nbsp;&bull;&nbsp; bouncepartyclub.com</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildRecoveryEmail(confirmUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background:#fff8f0;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr>
<td style="background:#f97316;padding:32px 40px;text-align:center;">
<img src="https://bouncepartyclub.com/bounce%20party%20club%20logo.png" alt="Bounce Party Club" style="height:72px;width:auto;display:block;margin:0 auto 12px;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Bounce Party Club</h1>
<p style="margin:6px 0 0;color:#fed7aa;font-size:14px;">Southeast Michigan's #1 Inflatable Rental Company</p>
</td>
</tr>
<tr>
<td style="padding:40px 40px 32px;">
<h2 style="margin:0 0 16px;font-size:22px;color:#1e293b;font-weight:700;">Reset Your Password</h2>
<p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">We received a request to reset the password for your Bounce Party Club account. Click the button below to set a new password.</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
<tr>
<td style="background:#f97316;border-radius:8px;text-align:center;">
<a href="${confirmUrl}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Reset My Password</a>
</td>
</tr>
</table>
<p style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-align:center;">Or copy and paste this link into your browser:</p>
<p style="margin:0 0 32px;font-size:12px;color:#64748b;text-align:center;word-break:break-all;">${confirmUrl}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">
<p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">If you didn't request a password reset, you can safely ignore this email. This link expires in 1 hour.</p>
</td>
</tr>
<tr>
<td style="background:#fff8f0;padding:24px 40px;text-align:center;border-top:1px solid #fed7aa;">
<p style="margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600;">Bounce Party Club</p>
<p style="margin:0;font-size:12px;color:#b45309;">(313) 889-3860 &nbsp;&bull;&nbsp; bouncepartyclub.com</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
