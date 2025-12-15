import { sendEmail, sendSms } from './notificationService';
import {
  createEmailWrapper,
  createGreeting,
  createParagraph,
  createAlertBox,
  createButton,
  createContactInfo,
  EMAIL_THEMES,
} from './emailTemplateBase';

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

    let content = createGreeting(order.customers?.first_name);
    content += createParagraph(
      `We've made some updates to your booking (Order #${order.id.slice(0, 8).toUpperCase()}) and need your approval to proceed.`
    );

    if (adminMessage.trim()) {
      content += createAlertBox({
        title: 'Message from Bounce Party Club',
        message: adminMessage,
        type: 'info',
      });
    }

    content += createAlertBox({
      title: 'Action Required',
      message: 'Please review the updated details and approve or request changes.',
      type: 'warning',
    });

    content += createButton({
      text: 'Review Order Changes',
      url: customerPortalUrl,
      theme: EMAIL_THEMES.primary,
    });

    content += createContactInfo();

    const emailHtml = createEmailWrapper({
      title: 'Order Updated - Approval Needed',
      headerTitle: 'Your Order Has Been Updated',
      content,
      theme: EMAIL_THEMES.primary,
    });

    if (order.customers?.email) {
      await sendEmail({
        to: order.customers.email,
        subject: `Order Updated - Approval Needed - Order #${order.id.slice(0, 8).toUpperCase()}`,
        html: emailHtml,
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

      await sendSms({
        to: order.customers.phone,
        message: smsMessage,
        orderId: order.id,
      });
    }
  } catch (error) {
    console.error('Error sending notifications:', error);
  }
}

interface BookingOrderDetails {
  id: string;
  event_date: string;
  deposit_due_cents: number;
  balance_due_cents: number;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  tax_cents: number;
  start_window: string;
  end_window: string;
  location_type: string;
  surface: string;
  attendees?: number;
  pets?: boolean;
  special_details?: string;
  travel_total_miles: number | null;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
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

export async function sendBookingConfirmationNotifications(order: BookingOrderDetails): Promise<void> {
  const { generateCustomerBookingEmail, generateAdminBookingEmail, generateCustomerSMS, generateAdminSMS } = await import('./bookingEmailTemplates');

  try {
    await sendCustomerBookingEmail(order, generateCustomerBookingEmail);
    await sendCustomerBookingSMS(order, generateCustomerSMS);
    await sendAdminBookingSMS(order, generateAdminSMS);
    await sendAdminBookingEmail(order, generateAdminBookingEmail);
  } catch (error) {
    console.error('[NOTIFICATION] Error in sendBookingConfirmationNotifications:', error);
  }
}

async function sendCustomerBookingEmail(order: BookingOrderDetails, generateEmail: (order: any) => string): Promise<void> {
  try {
    const emailHtml = generateEmail(order);
    await sendEmail({
      to: order.customer.email,
      subject: 'Booking Request Received - Bounce Party Club',
      html: emailHtml,
    });
  } catch (emailErr) {
    console.error('[NOTIFICATION] Error sending email notification:', emailErr);
  }
}

async function sendCustomerBookingSMS(order: BookingOrderDetails, generateSMS: (order: any) => string): Promise<void> {
  if (!order.customer.phone) {
    console.log('[NOTIFICATION] No phone number on file; SMS not sent.');
    return;
  }

  try {
    const smsMessage = generateSMS(order);
    await sendSms({
      to: order.customer.phone,
      message: smsMessage,
      orderId: order.id,
    });
  } catch (smsErr) {
    console.error('[NOTIFICATION] Error sending SMS notification:', smsErr);
  }
}

async function sendAdminBookingSMS(order: BookingOrderDetails, generateSMS: (order: any) => string): Promise<void> {
  try {
    const { sendAdminSms } = await import('./notificationService');
    const adminSmsMessage = generateSMS(order);
    await sendAdminSms(adminSmsMessage);
  } catch (adminErr) {
    console.error('[NOTIFICATION] Error sending admin SMS:', adminErr);
  }
}

async function sendAdminBookingEmail(order: BookingOrderDetails, generateEmail: (order: any) => string): Promise<void> {
  try {
    const { sendAdminEmail } = await import('./notificationService');
    const adminEmailHtml = generateEmail(order);
    await sendAdminEmail(
      `New Booking Request - Order #${order.id.slice(0, 8).toUpperCase()}`,
      adminEmailHtml
    );
  } catch (emailErr) {
    console.error('[NOTIFICATION] Error sending admin email:', emailErr);
  }
}
