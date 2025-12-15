export const ORDER_WITH_RELATIONS = `
  *,
  customers (
    id,
    first_name,
    last_name,
    email,
    phone,
    business_name
  ),
  addresses (
    id,
    line1,
    line2,
    city,
    state,
    zip,
    latitude,
    longitude
  ),
  order_items (
    id,
    quantity,
    unit_price_cents,
    use_wet_mode,
    units (
      id,
      name,
      description,
      category,
      price_cents,
      wet_price_cents
    )
  )
`;

export const ORDER_FULL_DETAILS = `
  *,
  customers (*),
  addresses (*),
  order_items (*, units (*)),
  payments (*),
  order_discounts (*),
  order_custom_fees (*)
`;

export const INVOICE_WITH_RELATIONS = `
  *,
  customers (*),
  orders (
    *,
    addresses (*),
    order_items (*, units (*))
  )
`;

export const CONTACT_WITH_STATS = `
  *,
  contact_stats (
    total_bookings,
    total_spent_cents,
    average_order_cents
  )
`;
