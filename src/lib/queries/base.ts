import { handleError } from '../errorHandling';

export interface QueryOptions {
  throwOnError?: boolean;
  context?: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: any;
}

export async function executeQuery<T>(
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
    zip
  ),
  order_items (
    id,
    order_id,
    unit_id,
    qty,
    wet_or_dry,
    unit_price_cents,
    notes,
    units (
      id,
      name,
      type,
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
  addresses (line1, line2, city, state, zip)
`;
