// What the /payment-complete confirmation page says (WP-P2-24a, F-39 current-release part). Pure: no network, no React.
// The page is reached after the booking checkout, which is SETUP ONLY: Stripe saves the card and nothing is charged. The wording must
// therefore keep three things apart:
//   1. card saved  (Stripe setup; no money moved)
//   2. booking request submitted  (the order is waiting for admin review)
//   3. a deposit actually paid  (only after approval, or an admin-invoice payment, which goes to the portal instead of this page)
// This page never proves a payment, so it never says one was taken. If the order has moved on since the request (the success URL is
// reopened after review), the page does not repeat "pending review / not charged": it points to the portal for the current status.

export interface BookingReturnCopy {
  state: 'submitted' | 'reviewed' | 'inactive';
  heading: string;
  intro: string;
  noticeTitle: string;
  noticeBody: string;
  depositLabel: string;
  tipTotalLabel: string;
  nextSteps: string;
}

export function bookingReturnCopy(orderStatus?: string | null): BookingReturnCopy {
  if (orderStatus === 'cancelled' || orderStatus === 'void') {
    return {
      state: 'inactive',
      heading: 'Booking Request Closed',
      intro: 'This booking request is no longer active.',
      noticeTitle: 'Card saved, not charged by this page',
      noticeBody: 'Opening this page does not charge your card. Open your customer portal to see the current status of this order and any payments on it.',
      depositLabel: 'Deposit Amount',
      tipTotalLabel: 'Deposit and Tip Amount',
      nextSteps: 'If you have questions about this order, please contact us.',
    };
  }
  if (orderStatus && orderStatus !== 'pending_review') {
    return {
      state: 'reviewed',
      heading: 'Booking Request Submitted',
      intro: 'Your booking request was submitted and has since been reviewed. Open your customer portal for its current status.',
      noticeTitle: 'Card saved, not charged by this page',
      noticeBody: 'Your card was saved securely when you submitted the request. Opening this page does not charge it. Any deposit payment is shown in your customer portal.',
      depositLabel: 'Deposit Amount',
      tipTotalLabel: 'Deposit and Tip Amount',
      nextSteps: 'Open your customer portal to see this order\'s status, payments and next steps.',
    };
  }
  return {
    state: 'submitted',
    heading: 'Booking Request Submitted',
    intro: 'Thank you for choosing Bounce Party Club. Your booking request has been submitted and is now pending admin review. This is not a confirmed booking yet.',
    noticeTitle: 'Your card was saved, not charged',
    noticeBody: 'Your card has been saved securely for this order. No payment has been taken. Your deposit is charged only after admin reviews and approves your request, typically within 24 hours.',
    depositLabel: 'Deposit Due After Approval',
    tipTotalLabel: 'Amount to Be Charged After Approval',
    nextSteps: 'Our admin team will review your booking request and contact you within 24 hours to confirm your delivery time window and finalize your reservation details.',
  };
}
