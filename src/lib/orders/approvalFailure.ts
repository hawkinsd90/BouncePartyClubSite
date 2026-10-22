// What a failed charge-deposit answer means to the Admin approving a booking (NI-01).
//
// The customer is told "your card was declined" ONLY when the server says so explicitly. The approval used to treat every failure it did
// not recognise as a decline, so an in-flight payment, a stale screen, a database hiccup, or even a charge that had gone through but was
// still being recorded (FINALIZATION_PENDING) sent the customer a false "Payment Declined" email and text.

/** Server codes that mean the card itself was refused or cannot be used, so the customer must act on it. */
export const CARD_REFUSAL_CODES: readonly string[] = ['CARD_DECLINED', 'PAYMENT_METHOD_INVALID'];

export type ApprovalFailureKind =
  // The card was refused or is unusable: tell the customer.
  | 'card_refused'
  // Stripe charged the card but the order update is not finished: a charge happened, nobody may be told it failed, never charge again.
  | 'charged_pending'
  // Anything else: the order was not confirmed, but nothing says the card is at fault. Tell the Admin only.
  | 'not_confirmed';

export function classifyApprovalFailure(data: { code?: unknown; chargeSucceeded?: unknown } | null | undefined): ApprovalFailureKind {
  if (data?.chargeSucceeded === true || data?.code === 'FINALIZATION_PENDING') return 'charged_pending';
  if (typeof data?.code === 'string' && CARD_REFUSAL_CODES.includes(data.code)) return 'card_refused';
  return 'not_confirmed';
}
