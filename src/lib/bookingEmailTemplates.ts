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
import { formatOrderId } from './utils';
import { buildPackageDisplay } from './packageDisplay';

interface OrderEmailItem {
  qty: number;
  wet_or_dry: string | null;
  unit_price_cents: number;
  unit_id: string | null;
  product_id: string | null;
  bundle_id: string | null;
  item_name: string | null;
  pricing_context: string | null;
  component_snapshot: any | null;
  units: { name: string } | null;
}

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
  tip_cents?: number;
  deposit_due_cents: number;
  balance_due_cents: number;
  travel_total_miles: number | null;
  addresses: {
    line1: string;
    city: string;
    state: string;
    zip: string;
  };
  order_items: OrderEmailItem[];
}

function renderEmailItems(items: OrderEmailItem[]): Array<{ description: string; amount: string }> {
  const result: Array<{ description: string; amount: string }> = [];
  for (const item of items) {
    // Inflatable item
    if (item.unit_id && item.units?.name) {
      const modeLabel = item.wet_or_dry === 'water' ? 'Wet' : 'Dry';
      result.push({
        description: `${item.qty}x ${item.units.name} <span style="color: #64748b; font-size: 13px;">(${modeLabel})</span>`,
        amount: `${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
      });
      continue;
    }

    // EE package item — render component snapshot first
    if (item.bundle_id) {
      const pkgDisplay = buildPackageDisplay({
        bundleName: item.item_name,
        bundleQty: item.qty,
        unitPriceCents: item.unit_price_cents,
        componentSnapshot: item.component_snapshot,
      });

      if (pkgDisplay.hasSnapshot && pkgDisplay.components.length > 0) {
        const componentLines = pkgDisplay.components.map(
          (c) => `${c.name} × ${c.quantity}`
        );
        result.push({
          description: `Included:<br/>${componentLines.map((l) => `- ${l}`).join('<br/>')}<br/><br/><strong>${pkgDisplay.packageName} × ${pkgDisplay.packageQty}</strong>`,
          amount: `${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
        });
      } else if (pkgDisplay.hasSnapshot) {
        result.push({
          description: `<strong>${pkgDisplay.packageName} × ${pkgDisplay.packageQty}</strong>`,
          amount: `${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
        });
      } else {
        result.push({
          description: `<strong>${pkgDisplay.packageName} × ${pkgDisplay.packageQty}</strong><br/><span style="color: #94a3b8; font-size: 13px;">Package contents unavailable</span>`,
          amount: `${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
        });
      }
      continue;
    }

    // EE product item
    const name = item.item_name || 'Event Essential';
    const isAddOn = item.pricing_context === 'addon';
    result.push({
      description: `${item.qty}x ${isAddOn ? `${name} (Add-on)` : name}`,
      amount: `${((item.unit_price_cents * item.qty) / 100).toFixed(2)}`,
    });
  }
  return result;
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
    { label: 'Order ID', value: `#${formatOrderId(order.id)}` },
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

  content += createItemsTable({
    title: 'Requested Items',
    items: renderEmailItems(order.order_items),
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

  if (order.tip_cents && order.tip_cents > 0) {
    pricingRows.push({
      label: 'Tip',
      value: `$${(order.tip_cents / 100).toFixed(2)}`,
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
    <div style="background-color: #f0fdf4; border: 2px solid #16a34a; border-radius: 6px; padding: 18px; margin: 25px 0;">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="font-size: 20px; line-height: 1;">&#x1F6E1;</div>
        <div>
          <h3 style="margin: 0 0 6px; color: #14532d; font-size: 15px; font-weight: 700;">Your card has not been charged</h3>
          <p style="margin: 0; color: #166534; font-size: 14px; line-height: 1.5;">Your payment information has been saved securely, but <strong>no charge will be made until admin reviews and approves your order</strong> — typically within 24 hours. You will receive a confirmation email once your booking is approved.</p>
        </div>
      </div>
    </div>
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
      { label: 'Order ID', value: `#${formatOrderId(order.id)}` },
      { label: 'Event Date', value: eventDateStr },
      { label: 'Time', value: `${order.start_window} - ${order.end_window}` },
      {
        label: 'Location',
        value: `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state}`,
      },
    ],
    theme: EMAIL_THEMES.primary,
  });

  content += createItemsTable({
    title: 'Items Requested',
    items: renderEmailItems(order.order_items),
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
    `NEW BOOKING REQUEST! ${order.customer.first_name} ${order.customer.last_name} ` +
    `for ${eventDateStr}. Review in admin panel. ` +
    `Order #${formatOrderId(order.id)}`
  );
}
