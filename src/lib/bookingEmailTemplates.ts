const LOGO_URL = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';

interface OrderEmailData {
  id: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  event_date: string;
  start_window: string;
  end_window: string;
  location_type: string;
  surface: string;
  attendees?: number;
  pets?: boolean;
  special_details?: string;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  tax_cents: number;
  deposit_due_cents: number;
  balance_due_cents: number;
  travel_total_miles: number | null;
  addresses: {
    line1: string;
    city: string;
    state: string;
    zip: string;
  };
  order_items: Array<{
    qty: number;
    wet_or_dry: string;
    unit_price_cents: number;
    units: {
      name: string;
    };
  }>;
}

export function generateCustomerBookingEmail(order: OrderEmailData): string {
  const fullName = `${order.customer.first_name} ${order.customer.last_name}`.trim();
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const orderItemsHtml = order.order_items.map(item => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
        <span style="color: #1e293b; font-weight: 500;">${item.qty}x ${item.units.name}</span>
        <span style="color: #64748b; font-size: 13px;"> (${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'})</span>
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: right; color: #1e293b;">
        $${((item.unit_price_cents * item.qty) / 100).toFixed(2)}
      </td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Booking Request Received</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
              <tr>
                <td style="background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 2px solid #3b82f6;">
                  <img src="${LOGO_URL}" alt="Bounce Party Club" style="height: 80px; width: auto;" />
                  <h1 style="margin: 15px 0 0; color: #1e293b; font-size: 24px; font-weight: bold;">Booking Request Received!</h1>
                </td>
              </tr>

              <tr>
                <td style="padding: 30px;">
                  <p style="margin: 0 0 20px; color: #1e293b; font-size: 16px;">Hi ${fullName},</p>
                  <p style="margin: 0 0 20px; color: #475569; font-size: 15px; line-height: 1.6;">
                    Thank you for choosing Bounce Party Club! We've received your booking request and are reviewing the details.
                  </p>

                  <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #1e40af; font-size: 16px; font-weight: 600;">Event Information</h3>
                    <table width="100%" cellpadding="6" cellspacing="0">
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Order ID:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">#${order.id.slice(0, 8).toUpperCase()}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Event Date:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${eventDateStr}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Time:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.start_window} - ${order.end_window}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Location:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.location_type}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Address:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Surface:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.surface}</td>
                      </tr>
                      ${order.attendees ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Expected Attendees:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.attendees}</td>
                      </tr>` : ''}
                      ${order.pets ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Pets:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.pets}</td>
                      </tr>` : ''}
                      ${order.special_details ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px; vertical-align: top;">Special Details:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.special_details}</td>
                      </tr>` : ''}
                    </table>
                  </div>

                  <div style="margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Requested Items</h3>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${orderItemsHtml}
                    </table>
                  </div>

                  <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Cost Breakdown</h3>
                    <table width="100%" cellpadding="6" cellspacing="0">
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Subtotal:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.subtotal_cents / 100).toFixed(2)}</td>
                      </tr>
                      ${order.travel_fee_cents > 0 ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Travel Fee${(order.travel_total_miles || 0) > 0 ? ` (${(order.travel_total_miles || 0).toFixed(1)} mi)` : ''}:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.travel_fee_cents / 100).toFixed(2)}</td>
                      </tr>` : ''}
                      ${order.surface_fee_cents > 0 ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Surface Fee:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.surface_fee_cents / 100).toFixed(2)}</td>
                      </tr>` : ''}
                      ${order.same_day_pickup_fee_cents > 0 ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Same Day Pickup:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.same_day_pickup_fee_cents / 100).toFixed(2)}</td>
                      </tr>` : ''}
                      ${order.tax_cents > 0 ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Tax:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.tax_cents / 100).toFixed(2)}</td>
                      </tr>` : ''}
                      <tr style="border-top: 2px solid #e2e8f0;">
                        <td style="color: #1e293b; font-size: 15px; font-weight: 600; padding-top: 10px;">Deposit Due:</td>
                        <td style="color: #10b981; font-size: 15px; font-weight: 700; text-align: right; padding-top: 10px;">$${(order.deposit_due_cents / 100).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 600;">Balance Due:</td>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 700; text-align: right;">$${(order.balance_due_cents / 100).toFixed(2)}</td>
                      </tr>
                    </table>
                  </div>

                  <div style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 6px; padding: 18px; margin: 25px 0;">
                    <h3 style="margin: 0 0 12px; color: #92400e; font-size: 15px; font-weight: 600;">Next Steps</h3>
                    <ul style="margin: 0; padding-left: 20px; color: #92400e; font-size: 14px; line-height: 1.8;">
                      <li>Our team will review your event details and confirm availability.</li>
                      <li>You'll receive a follow-up within 24 hours with your delivery window and final confirmation.</li>
                      <li>Your card will only be charged for the deposit once your booking is approved.</li>
                    </ul>
                  </div>

                  <p style="margin: 25px 0 0; color: #475569; font-size: 14px; line-height: 1.6;">
                    Questions? Call us at <strong style="color: #1e293b;">(313) 889-3860</strong>
                  </p>
                </td>
              </tr>

              <tr>
                <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 2px solid #3b82f6;">
                  <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
                    Bounce Party Club | (313) 889-3860
                  </p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                    4426 Woodward Ave, Wayne, MI 48184
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

export function generateAdminBookingEmail(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Booking Request</title>
    </head>
    <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
        <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 25px;">
          <img src="${LOGO_URL}" alt="Bounce Party Club" style="height: 70px; width: auto;" />
          <h2 style="color: #dc2626; margin: 15px 0 0;">New Booking Request!</h2>
        </div>

        <div style="background-color: #fef2f2; border: 2px solid #dc2626; border-radius: 6px; padding: 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #991b1b;">Customer Information</h3>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Name:</strong> ${order.customer.first_name} ${order.customer.last_name}</p>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Email:</strong> ${order.customer.email}</p>
          ${order.customer.phone ? `<p style="margin: 5px 0; color: #1e293b;"><strong>Phone:</strong> ${order.customer.phone}</p>` : ''}
        </div>

        <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #1e40af;">Event Details</h3>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Order ID:</strong> #${order.id.slice(0, 8).toUpperCase()}</p>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Event Date:</strong> ${eventDateStr}</p>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Time:</strong> ${order.start_window} - ${order.end_window}</p>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Location:</strong> ${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}</p>
        </div>

        <div style="background-color: #f8fafc; border-radius: 6px; padding: 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #1e293b;">Items Requested</h3>
          ${order.order_items.map(item => `
            <p style="margin: 5px 0; color: #1e293b;">${item.qty}x ${item.units.name} (${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'}) - $${((item.unit_price_cents * item.qty) / 100).toFixed(2)}</p>
          `).join('')}
        </div>

        <div style="background-color: #f8fafc; border-radius: 6px; padding: 18px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #1e293b;">Financial Summary</h3>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Subtotal:</strong> $${(order.subtotal_cents / 100).toFixed(2)}</p>
          ${order.travel_fee_cents > 0 ? `<p style="margin: 5px 0; color: #1e293b;"><strong>Travel Fee${(order.travel_total_miles || 0) > 0 ? ` (${(order.travel_total_miles || 0).toFixed(1)} mi)` : ''}:</strong> $${(order.travel_fee_cents / 100).toFixed(2)}</p>` : ''}
          ${order.surface_fee_cents > 0 ? `<p style="margin: 5px 0; color: #1e293b;"><strong>Surface Fee:</strong> $${(order.surface_fee_cents / 100).toFixed(2)}</p>` : ''}
          <p style="margin: 8px 0 0; padding-top: 8px; border-top: 2px solid #e2e8f0; color: #10b981;"><strong>Deposit Due:</strong> $${(order.deposit_due_cents / 100).toFixed(2)}</p>
          <p style="margin: 5px 0; color: #1e293b;"><strong>Balance Due:</strong> $${(order.balance_due_cents / 100).toFixed(2)}</p>
        </div>

        <p style="margin: 25px 0 0; padding: 18px; background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 6px; color: #92400e;">
          <strong>Action Required:</strong> Please review this booking request in the admin panel and confirm availability.
        </p>
      </div>
    </body>
    </html>
  `;
}

export function generateCustomerSMS(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `Hi ${order.customer.first_name}, we received your Bounce Party Club booking request for ${eventDateStr}. ` +
    `We'll review it and confirm within 24 hours. Your deposit will only be charged once your booking is approved. ` +
    `- Bounce Party Club`;
}

export function generateAdminSMS(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `NEW BOOKING! ${order.customer.first_name} ${order.customer.last_name} ` +
    `for ${eventDateStr}. Review in admin panel. ` +
    `Order #${order.id.slice(0, 8).toUpperCase()}`;
}
