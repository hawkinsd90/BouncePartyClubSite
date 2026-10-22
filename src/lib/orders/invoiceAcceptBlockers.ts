// WP-07 (B7): why the Admin Invoice "Accept" button is disabled. The button used to grey out with no explanation; the customer is
// now shown this list of what is still needed. The same list drives the disabled state, so the two cannot disagree.
export interface InvoiceAcceptState {
  processing: boolean;
  isNoCardRequired: boolean;
  isCardSetupOnly: boolean;
  cardOnFileConsent: boolean;
  smsConsent: boolean;
  nextDayPickup: boolean;
  overnightResponsibilityAccepted: boolean;
  paymentAmount: string;
  customPaymentAmount: string;
  needsCustomerInfo: boolean;
  customerInfo: { first_name?: string; last_name?: string; email?: string; phone?: string };
  howDidYouHearEnabled: boolean;
  referralAlreadyCaptured: boolean;
  referralSource: string;
}

export function invoiceAcceptBlockers(s: InvoiceAcceptState): string[] {
  const out: string[] = [];
  if (s.needsCustomerInfo) {
    const missing: string[] = [];
    if (!s.customerInfo.first_name) missing.push('first name');
    if (!s.customerInfo.last_name) missing.push('last name');
    if (!s.customerInfo.email) missing.push('email');
    if (!s.customerInfo.phone) missing.push('phone');
    if (missing.length > 0) out.push(`Your contact details (${missing.join(', ')})`);
  }
  if (!s.isNoCardRequired && !s.isCardSetupOnly && s.paymentAmount === 'custom' && !s.customPaymentAmount) out.push('The payment amount you want to pay today');
  if (s.howDidYouHearEnabled && !s.referralAlreadyCaptured && !s.referralSource) out.push('How you heard about us');
  if (s.nextDayPickup && !s.overnightResponsibilityAccepted) out.push('The overnight responsibility agreement');
  if (!s.isNoCardRequired && !s.cardOnFileConsent) out.push('Permission to keep your card on file');
  if (!s.smsConsent) out.push('Permission to text you about your order');
  return out;
}
