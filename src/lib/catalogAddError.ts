// Narrow production helper for the customer-facing add-to-cart error decision.
//
// Used by EventEssentialsCatalog to ensure both the page banner and the fixed
// toast receive the same controlled error message. Each separate failed click
// produces exactly one toast, even when the message matches the previous click.
// No dedup by comparing banner messages across separate customer attempts.

export interface AddErrorDecision {
  bannerMessage: string;
  showToast: boolean;
  shouldAddToCart: boolean;
  shouldResetDates: boolean;
}

export function decideAddError(_currentError: string | null, newError: string): AddErrorDecision {
  return {
    bannerMessage: newError,
    showToast: true,
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
