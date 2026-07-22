// Narrow production helper for the customer-facing add-to-cart error decision.
//
// Used by EventEssentialsCatalog to ensure both the page banner and the fixed
// toast receive the same controlled error message. A ref prevents duplicate
// toasts from the same click.

export interface AddErrorDecision {
  bannerMessage: string;
  showToast: boolean;
  shouldAddToCart: boolean;
  shouldResetDates: boolean;
}

export function decideAddError(currentError: string | null, newError: string): AddErrorDecision {
  return {
    bannerMessage: newError,
    showToast: currentError !== newError,
    shouldAddToCart: false,
    shouldResetDates: false,
  };
}

export function decideAddSuccess(): AddErrorDecision {
  return {
    bannerMessage: '',
    showToast: false,
    shouldAddToCart: true,
    shouldResetDates: true,
  };
}
