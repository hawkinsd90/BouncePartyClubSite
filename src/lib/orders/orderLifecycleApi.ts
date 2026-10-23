import { getEdgeAuthToken } from '../core/edgeAuth';
import { asErrorLike } from '../core/errorLike';

const LIFECYCLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/order-lifecycle`;

// Order-bound proof for non-admin callers. The server never trusts the order id alone: it needs an unexpired invoice
// token for this order, a completed Stripe Checkout session for this order, or a signed-in owner session.
// Admin/master callers authenticate with their session token and need no extra proof.
export interface LifecycleProof {
  sessionId?: string | null;
  invoiceToken?: string | null;
}

export type PaymentOutcome =
  | 'waived'
  | 'already_paid'
  | 'charged_now'
  | 'zero_due_with_card'
  | 'full_paid'
  | 'custom_paid'
  | 'cash';

async function callLifecycle(body: object, proof?: LifecycleProof): Promise<{ success: boolean; error?: string; alreadySent?: boolean }> {
  try {
    const response = await fetch(LIFECYCLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getEdgeAuthToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
        ...(proof?.sessionId ? { sessionId: proof.sessionId } : {}),
        ...(proof?.invoiceToken ? { invoiceToken: proof.invoiceToken } : {}),
      }),
    });

    let data: { success: boolean; error?: string; alreadySent?: boolean };
    try {
      data = await response.json();
    } catch {
      // console.error(`${logPrefix} — response was non-JSON, status=${response.status}`);
      return { success: false, error: `Non-JSON response from lifecycle (status ${response.status})` };
    }

    // if (!response.ok || !data.success) {
    //   console.error(`${logPrefix} — lifecycle returned failure: status=${response.status} error=${data.error ?? '(none)'} alreadySent=${data.alreadySent ?? false}`);
    // } else {
    //   console.log(`${logPrefix} — lifecycle success alreadySent=${data.alreadySent ?? false}`);
    // }

    return data;
  } catch (err) {
    // console.error(`${logPrefix} — network error: ${err.message ?? err}`);
    return { success: false, error: asErrorLike(err).message || 'Network error calling lifecycle function' };
  }
}

export async function enterPendingReview(
  orderId: string,
  source: string,
  proof?: LifecycleProof
): Promise<{ success: boolean; error?: string }> {
  return callLifecycle({ action: 'enter_pending_review', orderId, source }, proof);
}

export async function enterConfirmed(
  orderId: string,
  source: string,
  paymentOutcome: PaymentOutcome,
  oldStatusHint?: string | null,
  proof?: LifecycleProof
): Promise<{ success: boolean; error?: string }> {
  return callLifecycle({ action: 'enter_confirmed', orderId, source, paymentOutcome, ...(oldStatusHint ? { oldStatusHint } : {}) }, proof);
}
