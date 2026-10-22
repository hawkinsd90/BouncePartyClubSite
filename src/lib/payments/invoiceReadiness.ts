// Why the Create Invoice button is switched off, in words. A grey button with no reason is what a phone user sees otherwise.
export interface InvoiceReadinessInput {
  saving: boolean;
  hasNoActiveItems: boolean;
  hasAvailabilityIssues?: boolean;
  generatorResolutionPending?: boolean;
  checkingAvailability?: boolean;
  pricingIsCurrent?: boolean;
}

export function invoiceBlockedReason(i: InvoiceReadinessInput): string | null {
  if (i.saving) return null;
  if (i.hasNoActiveItems) return 'Add at least one item to turn on this button.';
  if (i.checkingAvailability) return 'Checking availability...';
  if (i.hasAvailabilityIssues) return 'Some items are not available for these dates. Fix the availability notice above.';
  if (i.generatorResolutionPending) return 'Answer the generator question above first.';
  if (i.pricingIsCurrent === false) return 'The price is still calculating. It will turn on in a moment.';
  return null;
}
