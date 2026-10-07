// Customer Portal read projection (Payment Safety A2.2).
//
// Every function here turns a raw database row into the narrow shape the Customer Portal UI actually uses. Each field
// list is an ALLOWLIST: a column that is not named here never reaches the browser, no matter what the table gains
// later. Nothing here talks to the database. Import-free so the Node test harness can load it unchanged.

// orders columns the portal UI reads (derived from the components in src/components/customer-portal, src/pages/Sign.tsx,
// src/pages/Receipt.tsx and the summary/email helpers they call; src/lib/portalProjection.test coverage asserts the
// UI never reads an order field outside this list).
export const PORTAL_ORDER_FIELDS: readonly string[] = [
  "id",
  "customer_id",
  "status",
  "workflow_status",
  "location_type",
  "surface",
  "can_use_stakes",
  "has_pets",
  "special_details",
  "event_date",
  "event_end_date",
  "start_window",
  "end_window",
  "event_start_time",
  "event_end_time",
  "pickup_preference",
  "subtotal_cents",
  "travel_fee_cents",
  "surface_fee_cents",
  "same_day_pickup_fee_cents",
  "same_day_weekday_delivery_fee_cents",
  "generator_fee_cents",
  "generator_qty",
  "setup_fee_cents",
  "tax_cents",
  "tip_cents",
  "travel_total_miles",
  "travel_per_mile_cents",
  "travel_fee_waived",
  "surface_fee_waived",
  "same_day_pickup_fee_waived",
  "same_day_weekday_delivery_fee_waived",
  "generator_fee_waived",
  "tax_waived",
  "deposit_due_cents",
  "deposit_paid_cents",
  "balance_due_cents",
  "balance_paid_cents",
  "custom_deposit_cents",
  "customer_selected_payment_cents",
  "customer_selected_payment_type",
  "stripe_payment_status",
  "payment_method_brand",
  "payment_method_last_four",
  "require_card_on_file",
  "referral_source",
  "referral_source_detail",
  "lot_pictures_requested",
  "waiver_signed_at",
  "admin_message",
  "parks_acknowledgment_required",
  "parks_acknowledgment_county",
];

// Present in the database, deliberately never sent. Kept as a list so a test can prove none of them leaks.
export const PORTAL_ORDER_EXCLUDED_FIELDS: readonly string[] = [
  "stripe_customer_id",
  "stripe_payment_method_id",
  "payment_method_id",
  "payment_lock",
  "waiver_signature_data",
  "signed_waiver_url",
  "signature_id",
  "edit_summary",
  "clear_payment_info",
  "archived_at",
  "cancelled_by",
  "refund_requested",
  "total_refunded_cents",
  "damage_charged_cents",
  "tax_waive_reason",
  "travel_fee_waive_reason",
  "surface_fee_waive_reason",
  "generator_fee_waive_reason",
  "same_day_pickup_fee_waive_reason",
  "same_day_weekday_delivery_fee_waive_reason",
  "pending_review_admin_alerted",
  "confirmed_admin_alerted",
  "booking_confirmation_sent",
  "billing_address_line1",
  "billing_address_line2",
  "billing_city",
  "billing_state",
  "billing_zip",
  "payment_method_exp_month",
  "payment_method_exp_year",
  "payment_method_validated_at",
  "current_eta",
];

type Row = Record<string, unknown>;

function pick(row: Row | null | undefined, fields: readonly string[]): Row {
  const out: Row = {};
  if (!row) return out;
  for (const f of fields) if (f in row && row[f] !== undefined) out[f] = row[f];
  return out;
}

export function projectCustomer(row: Row | null | undefined): Row | null {
  return row ? pick(row, ["id", "first_name", "last_name", "email", "phone", "business_name"]) : null;
}

export function projectAddress(row: Row | null | undefined): Row | null {
  return row ? pick(row, ["id", "line1", "line2", "city", "state", "zip", "lat", "lng"]) : null;
}

// Only what the customer's payment history needs. No processor ids, no raw metadata, no failure detail.
export function projectPayment(row: Row): Row {
  return pick(row, ["id", "order_id", "amount_cents", "type", "status", "payment_method", "payment_last4", "payment_brand", "created_at", "paid_at"]);
}

export function projectOrderItem(row: Row): Row {
  const out = pick(row, ["id", "order_id", "unit_id", "product_id", "bundle_id", "item_name", "pricing_context", "component_snapshot", "qty", "wet_or_dry", "unit_price_cents"]);
  const units = row.units as Row | null | undefined;
  if (units) out.units = pick(units, ["id", "name", "types", "price_dry_cents", "price_water_cents", "dimensions", "capacity"]);
  return out;
}

export function projectDiscount(row: Row): Row {
  return pick(row, ["id", "order_id", "name", "amount_cents", "percentage"]);
}

export function projectCustomFee(row: Row): Row {
  return pick(row, ["id", "order_id", "name", "amount_cents"]);
}

// The approval screen only reads which items were added in this change cycle.
export function projectChangelogEntry(row: Row): Row {
  return pick(row, ["field_changed", "old_value", "new_value", "created_at"]);
}

export function projectLotPicture(row: Row): Row {
  return pick(row, ["id", "file_path", "file_name", "notes", "uploaded_at"]);
}

export function projectPicture(row: Row): Row {
  return pick(row, ["id", "file_path", "file_name", "notes", "created_at"]);
}

// The invoice link row carries only the facts the invoice screen needs, never the token or the short code.
export function projectInvoiceLink(row: Row | null | undefined): Row | null {
  return row ? pick(row, ["id", "link_type", "customer_filled", "deposit_cents", "expires_at"]) : null;
}

export function projectDelivery(row: Row | null | undefined): Row | null {
  if (!row) return null;
  return {
    delivery_images: Array.isArray(row.delivery_images) ? row.delivery_images : [],
    status: row.status ?? null,
    completed_time: row.completed_time ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function projectOrder(
  order: Row,
  related: { customer?: Row | null; address?: Row | null; payments?: Row[] },
): Row {
  const out = pick(order, PORTAL_ORDER_FIELDS);
  // Presence only: the portal needs to know a card is on file, never the Stripe identifiers.
  out.has_saved_card = !!(order.stripe_customer_id && order.stripe_payment_method_id);
  // Presence only: the signed waiver document itself is not part of the portal payload.
  out.has_signed_waiver_document = !!order.signed_waiver_url;
  out.customers = projectCustomer(related.customer);
  out.addresses = projectAddress(related.address);
  out.payments = (related.payments ?? []).map(projectPayment);
  return out;
}

// The pricing configuration is public (it drives the public quote), and the summary builder needs it to re-derive waived
// fee amounts exactly as before.
export function projectPricing(row: Row | null | undefined): Row | null {
  return row ? { ...row } : null;
}
