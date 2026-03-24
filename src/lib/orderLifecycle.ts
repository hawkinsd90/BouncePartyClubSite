const LIFECYCLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/order-lifecycle`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type PaymentOutcome =
  | 'waived'
  | 'already_paid'
  | 'charged_now'
  | 'zero_due_with_card'
  | 'full_paid'
  | 'custom_paid'
  | 'cash';

async function callLifecycle(body: object): Promise<{ success: boolean; error?: string; alreadySent?: boolean }> {
  try {
    const response = await fetch(LIFECYCLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return data;
  } catch (err: any) {
    console.error('[orderLifecycle] Network error:', err);
    return { success: false, error: err.message || 'Network error calling lifecycle function' };
  }
}

export async function enterPendingReview(
  orderId: string,
  source: string
): Promise<{ success: boolean; error?: string }> {
  return callLifecycle({ action: 'enter_pending_review', orderId, source });
}

export async function enterConfirmed(
  orderId: string,
  source: string,
  paymentOutcome: PaymentOutcome
): Promise<{ success: boolean; error?: string }> {
  return callLifecycle({ action: 'enter_confirmed', orderId, source, paymentOutcome });
}
