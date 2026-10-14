// A refund request is identified by an operation key that stays the same when the request is retried (a double click, a timeout, a
// reload of the same form). The server reserves the refund under that key before it calls Stripe, so a retry settles the same
// refund instead of creating another one. A new key is made only for a different refund (another order or another amount).
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RefundAttempt {
  key: string;
  orderId: string;
  amountCents: number;
  // Set for an allocation-aware request: the canonical identity of its lines. The same identity is the same request.
  signature?: string;
}

function randomKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Not security sensitive (the server only needs it to be unique and stable); used only where crypto.randomUUID is unavailable.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

export function refundAttemptFor(previous: RefundAttempt | null, orderId: string, amountCents: number): RefundAttempt {
  if (previous && previous.orderId === orderId && previous.amountCents === amountCents) return previous;
  return { key: randomKey(), orderId, amountCents };
}

// An allocation-aware request keeps its key for exactly as long as its allocation is unchanged (the order of its lines does not
// matter: the signature is canonical). Another allocation is another request and gets another key.
export function allocationAttemptFor(previous: RefundAttempt | null, orderId: string, signature: string, totalCents: number): RefundAttempt {
  if (previous && previous.orderId === orderId && previous.signature === signature) return previous;
  return { key: randomKey(), orderId, amountCents: totalCents, signature };
}

export type RefundResponseKind = 'succeeded' | 'pending' | 'unresolved' | 'partial' | 'failed' | 'rejected' | 'unsettled' | 'conflict';

export interface RefundResponseSummary {
  kind: RefundResponseKind;
  // Show as a success, a warning or an error.
  tone: 'success' | 'warning' | 'error';
  message: string;
  // True when the same operation key must be sent again: the request is unfinished, or its final result is the one to keep showing.
  keepKey: boolean;
  // An earlier request on this order is still unsettled (this browser lost its key: a reload, another page, another entry point).
  // The server named it; the caller takes over that key and amount so the next press SETTLES it instead of starting another refund.
  adopt?: { key: string; amountCents: number };
}

const dollars = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;

// What an answer from the stripe-refund function means for the person who pressed the button.
export function classifyRefundResponse(httpStatus: number, data: any): RefundResponseSummary {
  const status = data?.status;
  const code = data?.code;

  // Another request on this order is unsettled: it must be resumed, not replaced.
  if (code === 'UNSETTLED_REFUND_EXISTS' && typeof data?.resumeOperationKey === 'string' && typeof data?.resumeAmountCents === 'number') {
    return {
      kind: 'unsettled', tone: 'warning', keepKey: true,
      adopt: { key: data.resumeOperationKey, amountCents: data.resumeAmountCents },
      message: `An earlier refund of ${dollars(data.resumeAmountCents)} on this order has not been settled yet. Press the button again to settle it; it will not be refunded twice. Start a different refund only after that.`,
    };
  }
  // The refund was refused before anything was sent to Stripe, with a reason the Admin can act on.
  const REFUSED: Record<string, string> = {
    DEPOSIT_CAPACITY_EXCEEDED: 'The deposit amount is more than that payment can still return. The available amounts have been refreshed; please review them.',
    BALANCE_CAPACITY_EXCEEDED: 'The remaining-balance amount is more than that payment can still return. The available amounts have been refreshed; please review them.',
    TIP_CAPACITY_EXCEEDED: 'The tip amount is more than that payment can still return. The available amounts have been refreshed; please review them.',
    EXCEEDS_REFUNDABLE: 'That is more than can still be refunded. The available amounts have been refreshed; please review them.',
    REFUND_HISTORY_AMBIGUOUS: 'Earlier refunds on this payment have no recorded breakdown, so this refund cannot be checked against what is left. Nothing was refunded. This needs manual review.',
    PAYMENT_UNCLASSIFIED: 'One of the payments has no recorded deposit / balance / tip breakdown, so it cannot be refunded by component.',
    PAYMENT_NOT_REFUNDABLE: 'One of the payments cannot be refunded through Stripe.',
    PAYMENT_NOT_SUCCEEDED: 'One of the payments was not completed, so it cannot be refunded.',
    PAYMENT_NOT_FOUND: 'One of the payments was not found.',
    PAYMENT_NOT_ON_ORDER: 'One of the payments does not belong to this order.',
    INVALID_ALLOCATION: 'The refund breakdown was not valid. Nothing was refunded.',
    ALLOCATION_TOTAL_MISMATCH: 'The refund total did not match the breakdown. Nothing was refunded.',
  };
  if (typeof code === 'string' && REFUSED[code]) {
    return { kind: 'rejected', tone: 'error', keepKey: false, message: REFUSED[code] };
  }
  // The key belongs to a different request already on record: this one must not be sent under it.
  if (code === 'OPERATION_KEY_REUSED') {
    return { kind: 'conflict', tone: 'error', keepKey: false, message: 'This refund conflicts with an earlier refund request that is already on record. Nothing was changed. Reload to see the earlier refund before trying again.' };
  }
  // An answer that is not JSON (a gateway page, a dropped body): whatever happened at the server is not known, so the request identity is kept.
  if (data == null) {
    return { kind: 'unresolved', tone: 'warning', keepKey: true, message: 'The refund request did not complete and the answer could not be read. Resume it to check; it will not be refunded twice.' };
  }
  if (code === 'REFUND_ALLOCATION_AMBIGUOUS') {
    return { kind: 'rejected', tone: 'error', keepKey: false, message: data?.error || 'This refund cannot be matched to a payment automatically; issue it in Stripe.' };
  }

  // Unfinished (a portion is pending at Stripe or its result is unknown, with or without a rejected portion): the identity is kept.
  if (httpStatus === 202 || status === 'unresolved' || (data?.final === false && (data?.failedCents > 0 || data?.unresolvedCents > 0))) {
    const rejected = data?.failedCents > 0 ? ` ${dollars(data.failedCents)} was rejected by Stripe.` : '';
    return { kind: 'unresolved', tone: 'warning', keepKey: true, message: `This refund is not finished.${rejected} Press the button again to settle it; nothing will be refunded twice. Do not start a new refund for the rest yet.` };
  }
  // Finished with a rejected portion: the same request would only repeat this answer, so the key is kept until the amount changes.
  if (httpStatus === 207 || status === 'partial') {
    return {
      kind: 'partial', tone: 'error', keepKey: true,
      message: `Only ${dollars(data?.succeededCents)} of ${dollars(data?.requestedCents)} was refunded; Stripe rejected ${dollars(data?.failedCents)}. To try the rejected part, enter ${dollars(data?.failedCents)} as a new refund.`,
    };
  }
  // Nothing was refunded: a new attempt is a new request.
  if (httpStatus === 422 || status === 'failed') {
    return { kind: 'failed', tone: 'error', keepKey: false, message: data?.error || 'Stripe rejected the refund.' };
  }
  if (httpStatus >= 200 && httpStatus < 300 && data?.success !== false) {
    if (status === 'pending') return { kind: 'pending', tone: 'success', keepKey: false, message: `Refund of ${dollars(data?.requestedCents)} submitted; Stripe is still processing it.` };
    return { kind: 'succeeded', tone: 'success', keepKey: false, message: `Refund of ${dollars(data?.requestedCents)} processed successfully!` };
  }
  // A server error or an answer that is not JSON: the refund may have been started, so the same key is kept for the retry.
  if (httpStatus >= 500 || data == null) {
    return { kind: 'unresolved', tone: 'warning', keepKey: true, message: (data?.error as string) || 'The refund request did not complete. Press the button again to retry; it will not be refunded twice.' };
  }
  return { kind: 'rejected', tone: 'error', keepKey: false, message: data?.error || 'Failed to process refund' };
}
