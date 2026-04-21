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
  const { action, orderId } = body as { action?: string; orderId?: string };
  const logPrefix = `[orderLifecycle] action=${action ?? '?'} orderId=${orderId ?? '?'}`;

  try {
    const response = await fetch(LIFECYCLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let data: { success: boolean; error?: string; alreadySent?: boolean };
    try {
      data = await response.json();
    } catch {
      console.error(`${logPrefix} — response was non-JSON, status=${response.status}`);
      return { success: false, error: `Non-JSON response from lifecycle (status ${response.status})` };
    }

    if (!response.ok || !data.success) {
      console.error(`${logPrefix} — lifecycle returned failure: status=${response.status} error=${data.error ?? '(none)'} alreadySent=${data.alreadySent ?? false}`);
    } else {
      console.log(`${logPrefix} — lifecycle success alreadySent=${data.alreadySent ?? false}`);
    }

    return data;
  } catch (err: any) {
    console.error(`${logPrefix} — network error: ${err.message ?? err}`);
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
  paymentOutcome: PaymentOutcome,
  oldStatusHint?: string
): Promise<{ success: boolean; error?: string }> {
  return callLifecycle({ action: 'enter_confirmed', orderId, source, paymentOutcome, ...(oldStatusHint ? { oldStatusHint } : {}) });
}
