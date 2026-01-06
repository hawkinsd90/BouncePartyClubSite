import { formatCurrency } from './utils';

// Enhanced Type Safety
export interface PrintableItem {
  name: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  metadata?: Record<string, unknown>;
}

export interface PrintableCharge {
  label: string;
  amount: number;
  description?: string;
  isNegative?: boolean;
}

export interface PrintableAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface PrintableContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessName?: string;
}

export interface PrintablePayment {
  method: string;
  brand?: string;
  last4?: string;
  amount: number;
  date: string;
  status: string;
}

export type PrintDocumentType = 'invoice' | 'receipt' | 'quote' | 'waiver' | 'catalog' | 'report';

export interface PrintableDocument<T = unknown> {
  type: PrintDocumentType;
  documentNumber?: string;
  title: string;
  date: string;
  items: PrintableItem[];
  charges: PrintableCharge[];
  subtotal: number;
  tax: number;
  total: number;
  contact?: PrintableContact;
  address?: PrintableAddress;
  payment?: PrintablePayment;
  notes?: string;
  metadata?: T;
}

// Print Templates System
export type PrintOrientation = 'portrait' | 'landscape';
export type PrintSize = 'letter' | 'a4' | 'legal';
export type PrintQuality = 'draft' | 'normal' | 'high';

export interface PrintTemplate {
  orientation: PrintOrientation;
  size: PrintSize;
  margins: string;
  showHeader: boolean;
  showFooter: boolean;
  quality?: PrintQuality;
}

export const PRINT_TEMPLATES: Record<PrintDocumentType, PrintTemplate> = {
  invoice: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.5in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  receipt: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.25in',
    showHeader: true,
    showFooter: true,
    quality: 'normal',
  },
  quote: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.5in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  waiver: {
    orientation: 'portrait',
    size: 'legal',
    margins: '0.75in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  catalog: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.5in',
    showHeader: false,
    showFooter: false,
    quality: 'normal',
  },
  report: {
    orientation: 'landscape',
    size: 'letter',
    margins: '1in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
};

// Print State Management
export type PrintState = 'idle' | 'preparing' | 'printing' | 'success' | 'error' | 'cancelled';

export interface PrintStateInfo {
  state: PrintState;
  message?: string;
  timestamp: number;
}

// Print Event Callbacks
export interface PrintEventCallbacks {
  onBeforePrint?: () => void | Promise<void>;
  onAfterPrint?: () => void | Promise<void>;
  onPrintStart?: () => void;
  onPrintSuccess?: () => void;
  onPrintError?: (error: Error) => void;
  onPrintCancel?: () => void;
}

export function formatPrintableAddress(address: PrintableAddress): string {
  const parts = [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.zip}`,
  ].filter(Boolean);

  return parts.join('\n');
}

export function formatPrintableContact(contact: PrintableContact): string {
  const parts = [];

  if (contact.businessName) {
    parts.push(contact.businessName);
  }

  parts.push(`${contact.firstName} ${contact.lastName}`);
  parts.push(contact.email);
  parts.push(contact.phone);

  return parts.join('\n');
}

export function formatPrintablePaymentMethod(payment: PrintablePayment): string {
  if (payment.brand && payment.last4) {
    return `${payment.brand} ending in ${payment.last4}`;
  }
  return payment.method;
}

export function calculatePrintableSubtotal(items: PrintableItem[]): number {
  return items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
}

export function calculatePrintableTotal(
  subtotal: number,
  charges: PrintableCharge[],
  tax: number
): number {
  const chargesTotal = charges.reduce((sum, charge) => {
    return sum + (charge.isNegative ? -charge.amount : charge.amount);
  }, 0);

  return subtotal + chargesTotal + tax;
}

export function transformOrderToPrintableDocument(
  order: any,
  orderItems: any[],
  discounts: any[] = [],
  customFees: any[] = []
): PrintableDocument {
  const items: PrintableItem[] = orderItems.map((item) => ({
    name: item.units?.name || 'Unknown Unit',
    description: item.wet_or_dry === 'water' ? 'Wet Mode' : 'Dry Mode',
    quantity: item.qty || 1,
    unitPrice: item.unit_price_cents,
    totalPrice: item.unit_price_cents * (item.qty || 1),
    metadata: {
      wetOrDry: item.wet_or_dry,
    },
  }));

  const charges: PrintableCharge[] = [];

  if (order.travel_fee_cents > 0) {
    charges.push({
      label: order.travel_total_miles
        ? `Travel Fee (${order.travel_total_miles.toFixed(1)} mi)`
        : 'Travel Fee',
      amount: order.travel_fee_cents,
    });
  }

  if (order.surface_fee_cents > 0) {
    charges.push({
      label: 'Surface Protection Fee',
      amount: order.surface_fee_cents,
    });
  }

  if (order.generator_fee_cents > 0) {
    charges.push({
      label: `Generator Fee (${order.generator_qty || 1}x)`,
      amount: order.generator_fee_cents,
    });
  }

  if (order.same_day_pickup_fee_cents > 0) {
    charges.push({
      label: 'Same Day Pickup Fee',
      amount: order.same_day_pickup_fee_cents,
    });
  }

  discounts.forEach((discount) => {
    let amount = 0;
    if (discount.amount_cents > 0) {
      amount = discount.amount_cents;
    } else if (discount.percentage > 0) {
      const taxableBase =
        order.subtotal_cents +
        (order.generator_fee_cents || 0) +
        order.travel_fee_cents +
        order.surface_fee_cents;
      amount = Math.round(taxableBase * (discount.percentage / 100));
    }

    if (amount > 0) {
      charges.push({
        label: discount.name || 'Discount',
        amount,
        description: discount.reason,
        isNegative: true,
      });
    }
  });

  customFees.forEach((fee) => {
    charges.push({
      label: fee.name,
      amount: fee.amount_cents,
      description: fee.description,
    });
  });

  const contact: PrintableContact | undefined = order.customers
    ? {
        firstName: order.customers.first_name || '',
        lastName: order.customers.last_name || '',
        email: order.customers.email || '',
        phone: order.customers.phone || '',
        businessName: order.customers.business_name,
      }
    : undefined;

  const address: PrintableAddress | undefined = order.addresses
    ? {
        line1: order.addresses.line1 || '',
        line2: order.addresses.line2,
        city: order.addresses.city || '',
        state: order.addresses.state || '',
        zip: order.addresses.zip || '',
      }
    : undefined;

  const subtotal = order.subtotal_cents;
  const tax = order.tax_cents;
  const total = calculatePrintableTotal(subtotal, charges, tax);

  return {
    type: 'invoice',
    documentNumber: order.id?.slice(0, 8).toUpperCase(),
    title: 'Invoice',
    date: order.event_date,
    items,
    charges,
    subtotal,
    tax,
    total,
    contact,
    address,
    notes: order.notes,
    metadata: {
      orderId: order.id,
      eventDate: order.event_date,
      startWindow: order.start_window,
      locationType: order.location_type,
      depositDue: order.deposit_due_cents,
      balanceDue: order.balance_due_cents,
    },
  };
}

export function transformPaymentToPrintableReceipt(
  payment: any,
  order: any,
  orderItems: any[]
): PrintableDocument {
  const baseDocument = transformOrderToPrintableDocument(order, orderItems);

  const paymentInfo: PrintablePayment = {
    method: payment.payment_method || 'Unknown',
    brand: payment.card_brand,
    last4: payment.card_last4,
    amount: payment.amount_cents,
    date: payment.created_at,
    status: payment.status,
  };

  return {
    ...baseDocument,
    type: 'receipt',
    title: 'Payment Receipt',
    payment: paymentInfo,
    metadata: {
      ...baseDocument.metadata,
      paymentId: payment.id,
      stripePaymentIntentId: payment.stripe_payment_intent_id,
    },
  };
}

export function formatDocumentNumber(type: string, number?: string): string {
  if (!number) return 'N/A';

  const prefix = {
    invoice: 'INV',
    receipt: 'RCT',
    quote: 'QTE',
    waiver: 'WVR',
    catalog: 'CAT',
    report: 'RPT',
  }[type] || 'DOC';

  return `${prefix}-${number}`;
}

export function getPrintStyles(): string {
  return `
    @media print {
      body {
        margin: 0;
        padding: 0;
        background: white;
      }

      .no-print {
        display: none !important;
      }

      .print-only {
        display: block !important;
      }

      .page-break {
        page-break-after: always;
      }

      .avoid-break {
        page-break-inside: avoid;
      }

      @page {
        margin: 0.5in;
        size: letter;
      }
    }

    @media screen {
      .print-only {
        display: none;
      }
    }
  `;
}
