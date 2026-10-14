// GENERATED COPY of src/lib/constants/statuses.ts (sliced). Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/tooling/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

export const ORDER_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending_review',
  CONFIRMED: 'confirmed',
  AWAITING_CUSTOMER_APPROVAL: 'awaiting_customer_approval',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  VOID: 'void',
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];
