// Pure reading of an order-lifecycle answer (no network, no env), so it can be tested without a browser.

// `code` is set when the server refuses a confirmation for stock reasons (AVAILABILITY_CONFLICT / AVAILABILITY_UNVERIFIABLE); `error` then
// already names the equipment and is written for the customer.
export interface LifecycleResult { success: boolean; error?: string; alreadySent?: boolean; code?: string }

export function isAvailabilityRefusal(result: LifecycleResult): boolean {
  return result.success === false && (result.code === 'AVAILABILITY_CONFLICT' || result.code === 'AVAILABILITY_UNVERIFIABLE') && typeof result.error === 'string' && result.error !== '';
}

export const CARD_SAVED_CONFIRM_FAILED_MESSAGE =
  'Your card was saved, but we could not finish confirming your booking. Please contact us so we can complete it.';

export interface CardSavedConfirmation {
  confirmed: boolean;
  // Shown to the customer when not confirmed. A stock refusal carries the server's equipment message.
  message: string | null;
}

// The customer returned from saving a card on an invoice with nothing to charge, and the portal asks the lifecycle function to confirm.
// Only a real success (or "already confirmed") counts as confirmed; a refusal or a thrown error never looks like success. The saved card
// and any payment records are not touched here.
export async function confirmAfterCardSave(requestConfirmation: () => Promise<LifecycleResult>): Promise<CardSavedConfirmation> {
  let result: LifecycleResult;
  try {
    result = await requestConfirmation();
  } catch {
    return { confirmed: false, message: CARD_SAVED_CONFIRM_FAILED_MESSAGE };
  }
  if (result.success || result.alreadySent) return { confirmed: true, message: null };
  if (isAvailabilityRefusal(result)) return { confirmed: false, message: result.error as string };
  return { confirmed: false, message: CARD_SAVED_CONFIRM_FAILED_MESSAGE };
}
