export const ORDER_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  AWAITING_CUSTOMER_APPROVAL: 'awaiting_customer_approval',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  VOIDED: 'voided',
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [ORDER_STATUS.DRAFT]: 'Draft',
  [ORDER_STATUS.PENDING]: 'Pending Review',
  [ORDER_STATUS.CONFIRMED]: 'Confirmed',
  [ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL]: 'Awaiting Approval',
  [ORDER_STATUS.COMPLETED]: 'Completed',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
  [ORDER_STATUS.VOIDED]: 'Voided',
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
