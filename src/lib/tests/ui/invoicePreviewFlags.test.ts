// InvoicePreview reads tax_waived / travel_fee_waived / surface_fee_waived / generator_fee_waived / same_day_pickup_fee_waived from the CHECKOUT-format
// quoteData. QuoteFormData has no such fields, so they are always undefined there and the preview passes `false`. Investigation result: that is the
// CORRECT value - the customer's quote / checkout cannot waive a fee (waivers are an Admin action on a saved order), the totals shown come from the
// priceBreakdown / unifiedTotals Checkout stores (not from these flags), and the portal-format preview carries the real flags in orderData. So nothing is
// functionally wrong and the code is left as it is; this test records the contract so a future change that starts storing waivers in the quote notices.
// PASS - LOCAL AUTOMATED (source assertions).
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const WAIVER = /(tax|travel_fee|surface_fee|generator_fee|same_day_pickup_fee)_waived/;

const quoteFormType = /export interface QuoteFormData \{[\s\S]*?\n\}/.exec(read('src/hooks/booking/useQuoteForm.ts'))?.[0] ?? '';
ok('found QuoteFormData', quoteFormType.length > 0);
ok('QuoteFormData has no waiver fields (a customer quote cannot waive a fee)', !WAIVER.test(quoteFormType));
ok('the quote form hook mentions no waiver field at all', !WAIVER.test(read('src/hooks/booking/useQuoteForm.ts')));
ok('Checkout stores quoteData, priceBreakdown, cart, contactData and unifiedTotals for the preview - no waiver flags', !WAIVER.test(/const handleViewInvoice = \(\) => \{[\s\S]*?\n {2}\};/.exec(read('src/pages/Checkout.tsx'))?.[0] ?? 'x_waived'));

const preview = read('src/pages/InvoicePreview.tsx');
ok('the checkout-format branch defaults every flag to false', (preview.match(/quoteData\.\w+_waived \|\| false/g) ?? []).length === 5);
ok('the totals come from priceBreakdown / unifiedTotals, not from the flags', /buildOrderSummary\(priceBreakdown, cart, quoteData, 0, data\.unifiedTotals \?\? null\)/.test(preview));
ok('the portal-format branch uses the stored order data (which carries the real flags)', /eventData = portal\.orderData;/.test(preview));

console.log(`invoicePreviewFlags: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} invoice preview flag test(s) failed`);
