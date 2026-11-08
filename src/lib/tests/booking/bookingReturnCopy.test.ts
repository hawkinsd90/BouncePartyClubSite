// WP-P2-24a (F-39, wording only): the /payment-complete page must keep "card saved (setup only)", "booking request submitted" and "deposit actually paid"
// apart. Pure copy rules plus SOURCE-LEVEL checks that the route and Stripe return URLs are unchanged. Not a UI integration test; NT-01 style Dev run NOT RUN.
import { readFileSync } from 'node:fs';
import { bookingReturnCopy } from '../../booking/bookingReturnCopy';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const all = (c: ReturnType<typeof bookingReturnCopy>) => Object.values(c).join(' ');

const pending = bookingReturnCopy('pending_review');
ok('pending: request submitted, pending review, not confirmed', /submitted/i.test(pending.intro) && /pending admin review/i.test(pending.intro) && /not a confirmed booking/i.test(pending.intro));
ok('pending: says card saved and no payment taken', /saved/i.test(pending.noticeBody) && /no payment has been taken/i.test(pending.noticeBody));
ok('pending: deposit charged only after approval', /after admin reviews and approves/i.test(pending.noticeBody));
ok('pending: amounts are labelled "after approval", never as paid', /after approval/i.test(pending.depositLabel) && /to be charged after approval/i.test(pending.tipTotalLabel));
ok('pending: heading does not claim payment or confirmation', !/paid|confirmed|payment received/i.test(pending.heading));
ok('missing status behaves like a fresh request', bookingReturnCopy(undefined).state === 'submitted' && bookingReturnCopy(null).state === 'submitted');

for (const status of ['confirmed', 'awaiting_customer_approval', 'in_progress', 'completed']) {
  const c = bookingReturnCopy(status);
  ok(`${status}: reopened page does not repeat pending-review or no-payment claims`, c.state === 'reviewed' && !/pending admin review|no payment has been taken|has not been charged/i.test(all(c)));
  ok(`${status}: does not claim a charge was made and points to the portal`, !/was charged|have been charged|payment received|paid in full/i.test(all(c)) && /portal/i.test(all(c)));
}
const cancelled = bookingReturnCopy('cancelled');
ok('cancelled/void: closed, not submitted-and-pending', cancelled.state === 'inactive' && bookingReturnCopy('void').state === 'inactive' && !/pending admin review/i.test(all(cancelled)));
ok('no state makes a blanket "card has not been charged" promise', ![pending, cancelled, bookingReturnCopy('confirmed')].some((c) => /your card has not been charged/i.test(all(c))));

// SOURCE-LEVEL: the view uses the copy; the route and the Stripe return URLs are preserved exactly.
const view = readFileSync('src/components/booking-return/BookingRequestReceivedView.tsx', 'utf8');
ok('source: view renders bookingReturnCopy', /bookingReturnCopy\(orderDetails\?\.status\)/.test(view) && /copy\.heading/.test(view) && /copy\.noticeBody/.test(view));
ok('source: old fixed claims are gone from the view', !/Request Received!/.test(view) && !/Your card has not been charged/.test(view));
const app = readFileSync('src/App.tsx', 'utf8');
ok('source: /payment-complete route unchanged', /<Route path="\/payment-complete" element=\{<StripeCheckoutReturn \/>\} \/>/.test(app));
const checkout = readFileSync('supabase/functions/stripe-checkout/index.ts', 'utf8');
ok('source: stripe-checkout success URLs unchanged', (checkout.match(/\/payment-complete\?session_id=\{CHECKOUT_SESSION_ID\}&order_id=\$\{orderId\}/g) ?? []).length === 2);

console.log(`bookingReturnCopy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
