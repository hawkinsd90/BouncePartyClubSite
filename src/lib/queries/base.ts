import { handleError } from '../core/errorHandling';

export interface QueryOptions {
  throwOnError?: boolean;
  context?: string;
}

export interface QueryResult<T> {
  data: T | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- QueryResult.error is read as an object (error.message) by ~30 callers across src/components and src/hooks and is a string or unknown for some producers; narrowing it ripples outside src/lib
  error: any;
}

export async function executeQuery<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same boundary type as QueryResult.error above
  queryFn: () => Promise<{ data: T | null; error: any }>,
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const { throwOnError = false, context = 'Query' } = options;

  try {
    const result = await queryFn();

    if (result.error) {
      handleError(result.error, context);

      if (throwOnError) {
        throw result.error;
      }
    }

    return result;
  } catch (error) {
    handleError(error, context);

    if (throwOnError) {
      throw error;
    }

    return { data: null, error };
  }
}

export const STANDARD_ORDER_SELECT = `
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
    lat,
    lng
  ),
  order_items (
    id,
    order_id,
    unit_id,
    product_id,
    bundle_id,
    item_name,
    pricing_context,
    component_snapshot,
    qty,
    wet_or_dry,
    unit_price_cents,
    notes,
    units (
      id,
      name,
      types,
      price_dry_cents,
      price_water_cents,
      dimensions,
      capacity
    )
  ),
  payments (
    id,
    order_id,
    amount_cents,
    type,
    status,
    stripe_payment_intent_id,
    payment_method,
    payment_last4,
    payment_brand,
    created_at
  ),
  order_discounts (
    id,
    order_id,
    name,
    amount_cents,
    percentage
  ),
  order_custom_fees (
    id,
    order_id,
    name,
    amount_cents
  )
`;

export const COMPACT_ORDER_SELECT = `
  *,
  customers (first_name, last_name, email, phone, business_name),
  addresses (line1, line2, city, state, zip, lat, lng)
`;
