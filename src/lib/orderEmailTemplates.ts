import { format } from 'date-fns';
import {
  createEmailWrapper,
  createGreeting,
  createParagraph,
  createInfoBox,
  createItemsTable,
  createPricingSummary,
  createBulletList,
  EMAIL_THEMES,
  COMPANY_PHONE,
} from './emailTemplateBase';
import { formatOrderId } from './utils';

interface OrderEmailData {
  order: any;
  customer: any;
  address: any;
  items: any[];
  payment?: any;
  totalCents: number;
}

export function generateConfirmationReceiptEmail(data: OrderEmailData): string {
  const { order, customer, address, items, payment, totalCents } = data;
  const eventDateStr = format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy');

  let content = createGreeting(customer.first_name);
  content += createParagraph(
    'Great news! Your booking is confirmed and your deposit has been processed.'
  );

  const eventDetailsRows = [
    { label: 'Order #', value: formatOrderId(order.id) },
    { label: 'Date', value: eventDateStr },
    { label: 'Time', value: `${order.start_window} - ${order.end_window}` },
    { label: 'Location', value: `${address?.line1}, ${address?.city}` },
  ];

  if (order.location_type) {
    eventDetailsRows.push({ label: 'Location Type', value: order.location_type });
  }

  if (order.surface) {
    eventDetailsRows.push({ label: 'Surface', value: order.surface });
  }

  if (order.has_pets) {
    eventDetailsRows.push({ label: 'Pets', value: 'Yes' });
  }

  if (order.special_details) {
    eventDetailsRows.push({ label: 'Special Details', value: order.special_details });
  }

  content += createInfoBox({
    title: 'Event Details',
    rows: eventDetailsRows,
    theme: EMAIL_THEMES.success,
  });

  const orderItems = items.map((item: any) => ({
    description: `${item.qty}x ${item.units.name} (${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'})`,
    amount: `$${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
  }));

  content += createItemsTable({
    title: 'Order Items',
    items: orderItems,
  });

  const pricingRows: Array<{ label: string; value: string; bold?: boolean; highlight?: boolean }> =
    [
      { label: 'Subtotal', value: `$${(order.subtotal_cents / 100).toFixed(2)}` },
    ];

  if ((order.travel_fee_cents ?? 0) > 0) {
    pricingRows.push({
      label: `Travel Fee${(order.travel_total_miles ?? 0) > 0 ? ` (${(order.travel_total_miles ?? 0).toFixed(1)} mi)` : ''}`,
      value: `$${((order.travel_fee_cents ?? 0) / 100).toFixed(2)}`,
    });
  }

  if ((order.surface_fee_cents ?? 0) > 0) {
    pricingRows.push({
      label: 'Surface Fee',
      value: `$${((order.surface_fee_cents ?? 0) / 100).toFixed(2)}`,
    });
  }

  if ((order.same_day_pickup_fee_cents ?? 0) > 0) {
    pricingRows.push({
      label: 'Same Day Pickup Fee',
      value: `$${((order.same_day_pickup_fee_cents ?? 0) / 100).toFixed(2)}`,
    });
  }

  if ((order.tax_cents ?? 0) > 0) {
    pricingRows.push({
      label: 'Tax',
      value: `$${((order.tax_cents ?? 0) / 100).toFixed(2)}`,
    });
  }

  pricingRows.push({
    label: 'Total',
    value: `$${(totalCents / 100).toFixed(2)}`,
    bold: true,
  });

  pricingRows.push({
    label: 'Deposit Paid',
    value: `$${(order.deposit_due_cents / 100).toFixed(2)}`,
    bold: true,
    highlight: true,
  });

  pricingRows.push({
    label: 'Balance Due',
    value: `$${(order.balance_due_cents / 100).toFixed(2)}`,
    bold: true,
  });

  content += createPricingSummary({
    title: 'Payment Summary',
    rows: pricingRows,
  });

  if (payment) {
    const paymentDate = payment.paid_at
      ? new Date(payment.paid_at).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : 'N/A';

    content += createInfoBox({
      title: 'Payment Receipt',
      rows: [
        {
          label: 'Payment Method',
          value: `${payment.payment_brand || 'Card'} ${payment.payment_last4 ? `•••• ${payment.payment_last4}` : ''}`,
        },
        {
          label: 'Amount Paid',
          value: `$${((payment.amount_cents || 0) / 100).toFixed(2)}`,
        },
        { label: 'Payment Date', value: paymentDate },
        {
          label: 'Transaction ID',
          value: `<span style="font-family: monospace;">${payment.id.slice(0, 8).toUpperCase()}</span>`,
        },
      ],
      theme: EMAIL_THEMES.success,
    });
  }

  content += `
    <div style="background-color: #eff6ff; border: 2px solid #3b82f6; border-radius: 6px; padding: 18px; margin: 25px 0;">
      <h3 style="margin: 0 0 12px; color: #1e40af; font-size: 15px; font-weight: 600;">What's Next?</h3>
      ${createBulletList({
        items: [
          'We will contact you closer to your event date to confirm details',
          'The remaining balance is due on or before your event date',
          `Reply to this email or call us at ${COMPANY_PHONE} with questions`,
        ],
        theme: 'info',
      })}
    </div>
  `;

  content += createParagraph('Thank you for choosing Bounce Party Club!');

  return createEmailWrapper({
    title: 'Booking Confirmed - Receipt',
    headerTitle: 'Booking Confirmed!',
    content,
    theme: EMAIL_THEMES.success,
  });
}

export function generateConfirmationSmsMessage(order: any, customerFirstName: string): string {
  return `Hi ${customerFirstName}, your booking for ${format(new Date(order.event_date + 'T12:00:00'), 'MMMM d, yyyy')} is confirmed! Order #${formatOrderId(order.id)}. We'll contact you closer to your event date. Reply to this message anytime with questions.`;
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
  return `Hi ${customerFirstName}, this is a test message from Bounce Party Club. Your order #${formatOrderId(order.id)} is confirmed!`;
}
