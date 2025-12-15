import {
  createEmailWrapper,
  createGreeting,
  createParagraph,
  createInfoBox,
  createItemsTable,
  createPricingSummary,
  createAlertBox,
  createContactInfo,
  createBulletList,
  EMAIL_THEMES,
} from './emailTemplateBase';

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
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  let content = createGreeting(order.customer.first_name);
  content += createParagraph(
    "Thank you for choosing Bounce Party Club! We've received your booking request and are reviewing the details."
  );

  const eventInfoRows = [
    { label: 'Order ID', value: `#${order.id.slice(0, 8).toUpperCase()}` },
    { label: 'Event Date', value: eventDateStr },
    { label: 'Time', value: `${order.start_window} - ${order.end_window}` },
    { label: 'Location', value: order.location_type },
    {
      label: 'Address',
      value: `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}`,
    },
    { label: 'Surface', value: order.surface },
  ];

  if (order.attendees) {
    eventInfoRows.push({ label: 'Expected Attendees', value: String(order.attendees) });
  }

  if (order.pets) {
    eventInfoRows.push({ label: 'Pets', value: String(order.pets) });
  }

  if (order.special_details) {
    eventInfoRows.push({ label: 'Special Details', value: order.special_details });
  }

  content += createInfoBox({
    title: 'Event Information',
    rows: eventInfoRows,
    theme: EMAIL_THEMES.primary,
  });

  const orderItems = order.order_items.map((item) => ({
    description: `${item.qty}x ${item.units.name} <span style="color: #64748b; font-size: 13px;">(${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'})</span>`,
    amount: `$${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
  }));

  content += createItemsTable({
    title: 'Requested Items',
    items: orderItems,
  });

  const pricingRows: Array<{ label: string; value: string; bold?: boolean; highlight?: boolean }> =
    [
      { label: 'Subtotal', value: `$${(order.subtotal_cents / 100).toFixed(2)}` },
    ];

  if (order.travel_fee_cents > 0) {
    pricingRows.push({
      label: `Travel Fee${(order.travel_total_miles || 0) > 0 ? ` (${(order.travel_total_miles || 0).toFixed(1)} mi)` : ''}`,
      value: `$${(order.travel_fee_cents / 100).toFixed(2)}`,
    });
  }

  if (order.surface_fee_cents > 0) {
    pricingRows.push({
      label: 'Surface Fee',
      value: `$${(order.surface_fee_cents / 100).toFixed(2)}`,
    });
  }

  if (order.same_day_pickup_fee_cents > 0) {
    pricingRows.push({
      label: 'Same Day Pickup',
      value: `$${(order.same_day_pickup_fee_cents / 100).toFixed(2)}`,
    });
  }

  if (order.tax_cents > 0) {
    pricingRows.push({
      label: 'Tax',
      value: `$${(order.tax_cents / 100).toFixed(2)}`,
    });
  }

  pricingRows.push({
    label: 'Deposit Due',
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
    title: 'Cost Breakdown',
    rows: pricingRows,
  });

  content += `
    <div style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 6px; padding: 18px; margin: 25px 0;">
      <h3 style="margin: 0 0 12px; color: #92400e; font-size: 15px; font-weight: 600;">Next Steps</h3>
      ${createBulletList({
        items: [
          'Our team will review your event details and confirm availability.',
          'You will receive a follow-up within 24 hours with your delivery window and final confirmation.',
          'Your card will only be charged for the deposit once your booking is approved.',
        ],
        theme: 'warning',
      })}
    </div>
  `;

  content += createContactInfo();

  return createEmailWrapper({
    title: 'Booking Request Received',
    headerTitle: 'Booking Request Received!',
    content,
    theme: EMAIL_THEMES.primary,
  });
}

export function generateAdminBookingEmail(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  let content = '';

  const customerInfoRows = [
    {
      label: 'Name',
      value: `${order.customer.first_name} ${order.customer.last_name}`,
    },
    { label: 'Email', value: order.customer.email },
  ];

  if (order.customer.phone) {
    customerInfoRows.push({ label: 'Phone', value: order.customer.phone });
  }

  content += createInfoBox({
    title: 'Customer Information',
    rows: customerInfoRows,
    theme: EMAIL_THEMES.danger,
  });

  content += createInfoBox({
    title: 'Event Details',
    rows: [
      { label: 'Order ID', value: `#${order.id.slice(0, 8).toUpperCase()}` },
      { label: 'Event Date', value: eventDateStr },
      { label: 'Time', value: `${order.start_window} - ${order.end_window}` },
      {
        label: 'Location',
        value: `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}`,
      },
    ],
    theme: EMAIL_THEMES.primary,
  });

  const orderItems = order.order_items.map((item) => ({
    description: `${item.qty}x ${item.units.name} (${item.wet_or_dry === 'water' ? 'Wet' : 'Dry'})`,
    amount: `$${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
  }));

  content += createItemsTable({
    title: 'Items Requested',
    items: orderItems,
  });

  const pricingRows: Array<{ label: string; value: string; bold?: boolean; highlight?: boolean }> =
    [
      { label: 'Subtotal', value: `$${(order.subtotal_cents / 100).toFixed(2)}` },
    ];

  if (order.travel_fee_cents > 0) {
    pricingRows.push({
      label: `Travel Fee${(order.travel_total_miles || 0) > 0 ? ` (${(order.travel_total_miles || 0).toFixed(1)} mi)` : ''}`,
      value: `$${(order.travel_fee_cents / 100).toFixed(2)}`,
    });
  }

  if (order.surface_fee_cents > 0) {
    pricingRows.push({
      label: 'Surface Fee',
      value: `$${(order.surface_fee_cents / 100).toFixed(2)}`,
    });
  }

  pricingRows.push({
    label: 'Deposit Due',
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
    title: 'Financial Summary',
    rows: pricingRows,
  });

  content += createAlertBox({
    title: 'Action Required',
    message:
      'Please review this booking request in the admin panel and confirm availability.',
    type: 'warning',
  });

  return createEmailWrapper({
    title: 'New Booking Request',
    headerTitle: 'New Booking Request!',
    content,
    theme: EMAIL_THEMES.danger,
  });
}

export function generateCustomerSMS(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    `Hi ${order.customer.first_name}, we received your Bounce Party Club booking request for ${eventDateStr}. ` +
    `We'll review it and confirm within 24 hours. Your deposit will only be charged once your booking is approved. ` +
    `- Bounce Party Club`
  );
}

export function generateAdminSMS(order: OrderEmailData): string {
  const eventDateStr = new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    `NEW BOOKING! ${order.customer.first_name} ${order.customer.last_name} ` +
    `for ${eventDateStr}. Review in admin panel. ` +
    `Order #${order.id.slice(0, 8).toUpperCase()}`
  );
}
