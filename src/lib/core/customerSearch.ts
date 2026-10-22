// Customer picker search. The list can hold hundreds of customers, and a dropdown that renders all of them is slow on a phone and
// hard to scroll, so the picker shows the best matches only and says how many more there are.
export const CUSTOMER_PICKER_LIMIT = 50;

export interface PickableCustomer {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  business_name?: string | null;
}

export function filterCustomers<T extends PickableCustomer>(customers: T[], query: string, limit: number = CUSTOMER_PICKER_LIMIT): { shown: T[]; total: number } {
  const q = query.trim().toLowerCase();
  const matches = q
    ? customers.filter((c) => {
        const fullName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.toLowerCase();
        return fullName.includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q) || (c.business_name ?? '').toLowerCase().includes(q);
      })
    : customers;
  return { shown: matches.slice(0, limit), total: matches.length };
}
