interface SendOrderEditNotificationsParams {
  order: any;
  adminMessage: string;
}

export async function sendOrderEditNotifications({
  order,
  adminMessage,
}: SendOrderEditNotificationsParams): Promise<void> {
  try {
    const customerPortalUrl = `${window.location.origin}/customer-portal/${order.id}`;
    const fullName = `${order.customers?.first_name} ${order.customers?.last_name}`.trim();

    const logoUrl = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Order Updated - Approval Needed</title>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
          <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 25px;">
            <img src="${logoUrl}" alt="Bounce Party Club" style="height: 70px; width: auto;" />
            <h2 style="color: #3b82f6; margin: 15px 0 0;">Your Order Has Been Updated</h2>
          </div>
          <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">Hi ${fullName},</p>
          <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">
            We've made some updates to your booking (Order #${order.id.slice(0, 8).toUpperCase()}) and need your approval to proceed.
          </p>
          ${adminMessage.trim() ? `
          <div style="background-color: #dbeafe; border: 2px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 6px;">
            <p style="margin: 0; color: #1e40af; font-weight: 600;">Message from Bounce Party Club:</p>
            <p style="margin: 10px 0 0; color: #1e40af; white-space: pre-wrap;">${adminMessage}</p>
          </div>` : ''}
          <div style="background-color: #fef3c7; border: 2px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 6px;">
            <p style="margin: 0; color: #92400e; font-weight: 600;">Action Required</p>
            <p style="margin: 10px 0 0; color: #92400e;">Please review the updated details and approve or request changes.</p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${customerPortalUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600;">
              Review Order Changes
            </a>
          </div>
          <p style="margin: 20px 0 0; color: #64748b; font-size: 14px;">
            If you have any questions, please contact us at (313) 889-3860.
          </p>
        </div>
      </body>
      </html>
    `;

    if (order.customers?.email) {
      const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
      await fetch(emailApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: order.customers.email,
          subject: `Order Updated - Approval Needed - Order #${order.id.slice(0, 8).toUpperCase()}`,
          html: emailHtml,
        }),
      });
    }

    if (order.customers?.phone) {
      let smsMessage =
        `Hi ${order.customers.first_name}, we've updated your Bounce Party Club booking ` +
        `(Order #${order.id.slice(0, 8).toUpperCase()}).`;

      if (adminMessage.trim()) {
        smsMessage += ` Note: ${adminMessage.trim()}`;
      }

      smsMessage += ` Please review and approve: ${customerPortalUrl}`;

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: order.customers?.phone,
          message: smsMessage,
          orderId: order.id,
        }),
      });
    }
  } catch (error) {
    console.error('Error sending notifications:', error);
  }
}
