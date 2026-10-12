// A refund request is identified by an operation key that stays the same when the request is retried (a double click, a timeout, a
// reload of the same form). The server reserves the refund under that key before it calls Stripe, so a retry settles the same
// refund instead of creating another one. A new key is made only for a different refund (another order or another amount).
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RefundAttempt {
  key: string;
  orderId: string;
  amountCents: number;
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

export type RefundResponseKind = 'succeeded' | 'pending' | 'unresolved' | 'partial' | 'failed' | 'rejected' | 'unsettled';

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
