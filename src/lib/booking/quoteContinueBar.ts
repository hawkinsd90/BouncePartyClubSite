// WP-24: what the Quote "Continue to Checkout" control says and whether it can be pressed. One rule shared by the pinned phone bar and
// the summary card button, so the two can never disagree (and a double tap while availability is being re-checked is ignored).
// WP-P1-12 (F-40): when the price cannot be calculated because no event address has been chosen (a saved or carried-over street without
// coordinates), the control says so instead of showing "Calculating your total..." forever.

export const CHOOSE_ADDRESS_REASON = 'Choose your event address from the suggestions list to see your total.';

export interface QuoteContinueInput {
  hasTotals: boolean;
  pricingConfigError: string | null;
  isCalculating: boolean;
  depositError: string | null | undefined;
  submitting: boolean;
  /** True when the form has no chosen address (no street, or a street without coordinates): pricing cannot start until one is chosen. */
  needsAddress?: boolean;
}

export interface QuoteContinueState {
  disabled: boolean;
  label: string;
  /** Why the button is disabled, in words a customer understands. Null when it can be pressed or is busy checking. */
  reason: string | null;
}

export function quoteContinueState(input: QuoteContinueInput): QuoteContinueState {
  if (input.submitting) return { disabled: true, label: 'Checking availability...', reason: null };
  if (input.pricingConfigError || input.depositError) {
    return { disabled: true, label: 'Continue to Checkout →', reason: 'Pricing is unavailable right now. Please contact us.' };
  }
  if (input.needsAddress && !input.hasTotals) {
    return { disabled: true, label: 'Continue to Checkout →', reason: CHOOSE_ADDRESS_REASON };
  }
  if (input.isCalculating || !input.hasTotals) {
    return { disabled: true, label: 'Continue to Checkout →', reason: 'Calculating your total...' };
  }
  return { disabled: false, label: 'Continue to Checkout →', reason: null };
}
