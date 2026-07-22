// Production helper for the customer-facing add-to-cart error decision.
//
// Wired into EventEssentialsCatalog.setAddErrorWithToast.
// Each separate failed click produces exactly one toast, even when the
// message matches the previous click. No dedup by comparing banner messages
// across separate customer attempts.

export interface AddErrorDecision {
  bannerMessage: string;
  showToast: boolean;
}

export function decideAddError(_currentError: string | null, newError: string): AddErrorDecision {
  return {
    bannerMessage: newError,
    showToast: true,
  };
}
