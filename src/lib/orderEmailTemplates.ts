import { format } from 'date-fns';

interface OrderEmailData {
  order: any;
  customer: any;
  address: any;
  items: any[];
  payment?: any;
  totalCents: number;
}

const LOGO_URL =
  'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';
const COMPANY_PHONE = '(313) 889-3860';
const COMPANY_ADDRESS = '4426 Woodward Ave, Wayne, MI 48184';

export function generateConfirmationReceiptEmail(data: OrderEmailData): string {
  const { order, customer, address, items, payment, totalCents } = data;
  const eventDateStr = format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy');

  const orderItemsHtml = items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">
        ${item.qty}x ${item.units.name} (${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'})
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #1e293b;">
        $${((item.unit_price_cents * item.qty) / 100).toFixed(2)}
      </td>
    </tr>
  `
    )
    .join('');

  const paymentSection = payment
    ? `
    <div style="background-color: #f0fdf4; border: 2px solid #10b981; border-radius: 6px; padding: 20px; margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: #15803d; font-size: 16px; font-weight: 600;">Payment Receipt</h3>
      <table width="100%" cellpadding="6" cellspacing="0">
        <tr>
          <td style="color: #64748b; font-size: 14px;">Payment Method:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">
            ${payment.payment_brand || 'Card'} ${payment.payment_last4 ? `•••• ${payment.payment_last4}` : ''}
          </td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">Amount Paid:</td>
          <td style="color: #10b981; font-size: 14px; font-weight: 600; text-align: right;">$${((payment.amount_cents || 0) / 100).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">Payment Date:</td>
          <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">
            ${
              payment.paid_at
                ? new Date(payment.paid_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })
                : 'N/A'
            }
          </td>
        </tr>
        <tr>
          <td style="color: #64748b; font-size: 14px;">Transaction ID:</td>
          <td style="color: #64748b; font-size: 13px; text-align: right; font-family: monospace;">
            ${payment.id.slice(0, 8).toUpperCase()}
          </td>
        </tr>
      </table>
    </div>
  `
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Booking Confirmed - Receipt</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #10b981;">
              <tr>
                <td style="background-color: #ffffff; padding: 30px; text-align: center; border-bottom: 2px solid #10b981;">
                  <img src="${LOGO_URL}" alt="Bounce Party Club" style="height: 80px; width: auto;" />
                  <h1 style="margin: 15px 0 0; color: #10b981; font-size: 24px; font-weight: bold;">Booking Confirmed!</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  <p style="margin: 0 0 20px; color: #1e293b; font-size: 16px;">Hi ${customer.first_name},</p>
                  <p style="margin: 0 0 20px; color: #475569; font-size: 15px;">
                    Great news! Your booking is confirmed and your deposit has been processed.
                  </p>

                  <div style="background-color: #f0fdf4; border: 2px solid #10b981; border-radius: 6px; padding: 20px; margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #15803d; font-size: 16px; font-weight: 600;">Event Details</h3>
                    <table width="100%" cellpadding="6" cellspacing="0">
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Order #:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.id.slice(0, 8).toUpperCase()}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Date:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${eventDateStr}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Time:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.start_window} - ${order.end_window}</td>
                      </tr>
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Location:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${address?.line1}, ${address?.city}</td>
                      </tr>
                      ${
                        order.location_type
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Location Type:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.location_type}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        order.surface
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Surface:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.surface}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        order.has_pets
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Pets:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">Yes</td>
                      </tr>`
                          : ''
                      }
                      ${
                        order.special_details
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px; vertical-align: top;">Special Details:</td>
                        <td style="color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${order.special_details}</td>
                      </tr>`
                          : ''
                      }
                    </table>
                  </div>

                  <div style="margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Order Items</h3>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${orderItemsHtml}
                    </table>
                  </div>

                  <div style="background-color: #f8fafc; border-radius: 6px; padding: 20px; margin: 25px 0;">
                    <h3 style="margin: 0 0 15px; color: #1e293b; font-size: 16px; font-weight: 600;">Payment Summary</h3>
                    <table width="100%" cellpadding="6" cellspacing="0">
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Subtotal:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${(order.subtotal_cents / 100).toFixed(2)}</td>
                      </tr>
                      ${
                        (order.travel_fee_cents ?? 0) > 0
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Travel Fee${(order.travel_total_miles ?? 0) > 0 ? ` (${(order.travel_total_miles ?? 0).toFixed(1)} mi)` : ''}:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${((order.travel_fee_cents ?? 0) / 100).toFixed(2)}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        (order.surface_fee_cents ?? 0) > 0
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Surface Fee:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${((order.surface_fee_cents ?? 0) / 100).toFixed(2)}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        (order.same_day_pickup_fee_cents ?? 0) > 0
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Same Day Pickup Fee:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${((order.same_day_pickup_fee_cents ?? 0) / 100).toFixed(2)}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        (order.tax_cents ?? 0) > 0
                          ? `
                      <tr>
                        <td style="color: #64748b; font-size: 14px;">Tax:</td>
                        <td style="color: #1e293b; font-size: 14px; text-align: right;">$${((order.tax_cents ?? 0) / 100).toFixed(2)}</td>
                      </tr>`
                          : ''
                      }
                      <tr style="border-top: 2px solid #e2e8f0;">
                        <td style="color: #1e293b; font-size: 15px; font-weight: 600; padding-top: 10px;">Total:</td>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 700; text-align: right; padding-top: 10px;">$${(totalCents / 100).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="color: #10b981; font-size: 15px; font-weight: 600;">Deposit Paid:</td>
                        <td style="color: #10b981; font-size: 15px; font-weight: 700; text-align: right;">$${(order.deposit_due_cents / 100).toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 600;">Balance Due:</td>
                        <td style="color: #1e293b; font-size: 15px; font-weight: 700; text-align: right;">$${(order.balance_due_cents / 100).toFixed(2)}</td>
                      </tr>
                    </table>
                  </div>

                  ${paymentSection}

                  <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 18px; margin: 25px 0;">
                    <h3 style="margin: 0 0 12px; color: #1e40af; font-size: 15px; font-weight: 600;">What's Next?</h3>
                    <ul style="margin: 0; padding-left: 20px; color: #1e40af; font-size: 14px; line-height: 1.8;">
                      <li>We'll contact you closer to your event date to confirm details</li>
                      <li>The remaining balance is due on or before your event date</li>
                      <li>Reply to this email or call us at ${COMPANY_PHONE} with questions</li>
                    </ul>
                  </div>

                  <p style="margin: 25px 0 0; color: #475569; font-size: 14px;">
                    Thank you for choosing Bounce Party Club!
                  </p>
                </td>
              </tr>
              <tr>
                <td style="background-color: #f8fafc; padding: 25px; text-align: center; border-top: 2px solid #10b981;">
                  <p style="margin: 0 0 5px; color: #64748b; font-size: 13px;">
                    Bounce Party Club | ${COMPANY_PHONE}
                  </p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                    ${COMPANY_ADDRESS}
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

export function generateConfirmationSmsMessage(order: any, customerFirstName: string): string {
  return `Hi ${customerFirstName}, your booking for ${format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')} is confirmed! Order #${order.id.slice(0, 8).toUpperCase()}. We'll contact you closer to your event date. Reply to this message anytime with questions.`;
}

export function generateRejectionSmsMessage(
  order: any,
  customerFirstName: string,
  reason: string
): string {
  return `Hi ${customerFirstName}, unfortunately we cannot accommodate your booking for ${format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')}. Reason: ${reason}. Please contact us if you have questions.`;
}

export function generatePaymentLinkSmsMessage(
  customerFirstName: string,
  paymentUrl: string
): string {
  return `Hi ${customerFirstName}, your invoice is ready! Please complete payment to secure your booking: ${paymentUrl}`;
}

export function generateTestSmsMessage(order: any, customerFirstName: string): string {
  return `Hi ${customerFirstName}, this is a test message from Bounce Party Club. Your order #${order.id.slice(0, 8).toUpperCase()} is confirmed!`;
}
