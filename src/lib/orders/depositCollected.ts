// Whether the deposit an order currently requires has actually been collected (NI-02).
//
// The customer approval screens treated ANY deposit paid (deposit_paid_cents > 0) as "already paid" and confirmed without charging. When an
// Admin raised the deposit after a partial payment ("require the difference now"), that skipped the catch-up charge, and the lifecycle then
// refused the confirmation because paid < due. The deposit is collected only when what was paid covers what is due, using the same rule the
// confirmation itself applies (supabase/functions/_shared/orders/lifecycle-outcome.ts, customer_approval_already_paid).

export interface DepositCollectionFields {
  deposit_due_cents?: number | null;
  deposit_paid_cents?: number | null;
  stripe_payment_status?: string | null;
}

export function isDepositFullyCollected(order: DepositCollectionFields): boolean {
  const due = typeof order.deposit_due_cents === 'number' ? order.deposit_due_cents : 0;
  const paid = typeof order.deposit_paid_cents === 'number' ? order.deposit_paid_cents : 0;
  return paid >= due && (paid > 0 || order.stripe_payment_status === 'paid');
}

/** Some of the deposit was paid but not all that is now required: a catch-up charge is needed before confirming. */
export function hasDepositShortfall(order: DepositCollectionFields): boolean {
  const paid = typeof order.deposit_paid_cents === 'number' ? order.deposit_paid_cents : 0;
  return paid > 0 && !isDepositFullyCollected(order);
}
