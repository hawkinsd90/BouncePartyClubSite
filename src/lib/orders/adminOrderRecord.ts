// The shape of an order as the Admin screens receive it: a row of `orders` plus the related rows they ask for with
// `select('*, customers(*), addresses(*), order_items(*, units(*)), order_custom_fees(*), order_discounts(*), ...')`.
// Type-only (no runtime code). Columns come from src/lib/database.types.ts, which mirrors the migrated database; the extra
// optional fields below are columns that exist in the migrated `orders` table but are not in that file yet.
import type { Database } from '../database.types';

type Tables = Database['public']['Tables'];

// The Admin selects embed customers/addresses either whole (`customers (*)`) or only the columns the screen shows, so everything past the
// columns every select includes is optional here.
type CustomerEmbed = Pick<Tables['customers']['Row'], 'first_name' | 'last_name' | 'email' | 'phone'> & Partial<Tables['customers']['Row']>;
type AddressEmbed = Pick<Tables['addresses']['Row'], 'line1' | 'city' | 'state' | 'zip'> & Partial<Tables['addresses']['Row']>;

export type AdminOrderRecord = Tables['orders']['Row'] & {
  // columns present in the migrated orders table that database.types.ts does not list yet
  refund_requested?: boolean | null;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  waived_fee_amounts_cents?: Record<string, number> | null;
  // related rows (embedded by the selects)
  customers?: CustomerEmbed | null;
  addresses?: AddressEmbed | null;
  order_items?: Array<Tables['order_items']['Row'] & { units?: Tables['units']['Row'] | null }>;
  order_custom_fees?: Array<Tables['order_custom_fees']['Row']>;
  order_discounts?: Array<Tables['order_discounts']['Row']>;
  payments?: Array<Tables['payments']['Row']>;
  order_changelog?: Array<{ change_type: string; notes: string | null; created_at: string }>;
};
