// WP-24: what the Quote "Continue to Checkout" control says and whether it can be pressed. One rule shared by the pinned phone bar and
// the summary card button, so the two can never disagree (and a double tap while availability is being re-checked is ignored).

export interface QuoteContinueInput {
  hasTotals: boolean;
  pricingConfigError: string | null;
  isCalculating: boolean;
  depositError: string | null | undefined;
  submitting: boolean;
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
  if (input.isCalculating || !input.hasTotals) {
    return { disabled: true, label: 'Continue to Checkout →', reason: 'Calculating your total...' };
  }
  return { disabled: false, label: 'Continue to Checkout →', reason: null };
}
