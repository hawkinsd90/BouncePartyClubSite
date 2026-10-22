// One availability problem shown above the items of an order or invoice: a unit with conflicting orders, or a message
// (Event Essentials, a failed check). Type-only.
export interface AvailabilityIssue {
  unitName: string;
  unitId?: string;
  conflicts?: unknown[];
  error?: string;
}
