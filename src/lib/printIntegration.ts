import { transformOrderToPrintableDocument, transformPaymentToPrintableReceipt } from './printUtils';

export function prepareInvoicePreview(order: any, orderItems: any[], discounts: any[] = [], customFees: any[] = []) {
  return transformOrderToPrintableDocument(order, orderItems, discounts, customFees);
}

export function preparePaymentReceipt(payment: any, order: any, orderItems: any[]) {
  return transformPaymentToPrintableReceipt(payment, order, orderItems);
}

export function prepareQuotePreview(quoteData: any, cart: any[], priceBreakdown: any, contactData: any) {
  const mockOrder = {
    id: 'QUOTE-' + Date.now(),
    event_date: quoteData.event_date,
    start_window: quoteData.start_window,
    subtotal_cents: priceBreakdown.subtotal_cents,
    travel_fee_cents: priceBreakdown.travel_fee_cents,
    travel_total_miles: priceBreakdown.travel_total_miles,
    surface_fee_cents: priceBreakdown.surface_fee_cents,
    generator_fee_cents: priceBreakdown.generator_fee_cents || 0,
    generator_qty: quoteData.generator_qty || 0,
    same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents || 0,
    tax_cents: priceBreakdown.tax_cents,
    deposit_due_cents: priceBreakdown.deposit_due_cents,
    balance_due_cents: priceBreakdown.balance_due_cents,
    addresses: {
      line1: quoteData.address_line1,
      line2: quoteData.address_line2,
      city: quoteData.city,
      state: quoteData.state,
      zip: quoteData.zip,
    },
    customers: {
      first_name: contactData.first_name,
      last_name: contactData.last_name,
      email: contactData.email,
      phone: contactData.phone,
      business_name: contactData.business_name,
    },
    location_type: quoteData.location_type,
    pickup_preference: quoteData.pickup_preference,
    surface: quoteData.surface,
  };

  const mockItems = cart.map((item: any) => ({
    units: { name: item.unit_name },
    wet_or_dry: item.wet_or_dry,
    unit_price_cents: item.unit_price_cents,
    qty: item.qty || 1,
  }));

  return transformOrderToPrintableDocument(mockOrder, mockItems);
}

export function prepareCatalogPrint(units: any[]) {
  return {
    type: 'catalog' as const,
    title: 'Product Catalog',
    date: new Date().toISOString(),
    items: units.map(unit => ({
      name: unit.name,
      description: unit.description,
      metadata: {
        dimensions: unit.dimensions,
        capacity: unit.capacity,
        images: unit.images,
        dryPrice: unit.price_dry_cents,
        wetPrice: unit.price_water_cents,
      },
    })),
    charges: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  };
}

export function prepareWaiverPrint(signature: any, order: any) {
  return {
    type: 'waiver' as const,
    documentNumber: signature.id?.slice(0, 8).toUpperCase(),
    title: 'Rental Agreement & Liability Waiver',
    date: signature.signed_at || new Date().toISOString(),
    items: [],
    charges: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    contact: order.customers ? {
      firstName: order.customers.first_name,
      lastName: order.customers.last_name,
      email: order.customers.email,
      phone: order.customers.phone,
      businessName: order.customers.business_name,
    } : undefined,
    metadata: {
      signatureData: signature.signature_data,
      ipAddress: signature.ip_address,
      signedAt: signature.signed_at,
      orderId: order.id,
    },
  };
}
