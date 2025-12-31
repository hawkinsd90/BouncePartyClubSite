export const ORDER_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending_review',
  CONFIRMED: 'confirmed',
  AWAITING_CUSTOMER_APPROVAL: 'awaiting_customer_approval',
  SETUP_IN_PROGRESS: 'setup_in_progress',
  ON_THE_WAY: 'on_the_way',
  SETUP_COMPLETED: 'setup_completed',
  PICKUP_IN_PROGRESS: 'pickup_in_progress',
  ON_THE_WAY_BACK: 'on_the_way_back',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  VOID: 'void',
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [ORDER_STATUS.DRAFT]: 'Draft',
  [ORDER_STATUS.PENDING]: 'Pending Review',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL]: 'Awaiting Approval',
  [ORDER_STATUS.SETUP_IN_PROGRESS]: 'Setup In Progress',
  [ORDER_STATUS.ON_THE_WAY]: 'On The Way',
  [ORDER_STATUS.SETUP_COMPLETED]: 'Setup Completed',
  [ORDER_STATUS.PICKUP_IN_PROGRESS]: 'Pickup In Progress',
  [ORDER_STATUS.ON_THE_WAY_BACK]: 'On The Way Back',
  [ORDER_STATUS.COMPLETED]: 'Completed',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
  [ORDER_STATUS.VOID]: 'Void',
};

export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL,
  ORDER_STATUS.CONFIRMED,
] as const;

export const PAYMENT_STATUS = {
  PAYMENT_DUE: 'payment_due',
  DEPOSIT_PAID: 'deposit_paid',
  PAID_IN_FULL: 'paid_in_full',
} as const;

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

export function getPaymentStatus(order: {
  deposit_paid_cents: number;
  balance_paid_cents: number;
  deposit_due_cents: number;
  balance_due_cents: number;
}): PaymentStatus {
  const totalPaid = order.deposit_paid_cents + order.balance_paid_cents;
  const totalDue = order.deposit_due_cents + order.balance_due_cents;

  if (totalPaid >= totalDue) {
    return PAYMENT_STATUS.PAID_IN_FULL;
  } else if (order.deposit_paid_cents > 0) {
    return PAYMENT_STATUS.DEPOSIT_PAID;
  }
  return PAYMENT_STATUS.PAYMENT_DUE;
}

export function isOrderCancellable(status: string): boolean {
  return CANCELLABLE_STATUSES.includes(status as OrderStatus);
}
