// WP-07 (B7): the waiver and Admin Invoice screens, plus the signature payload rules used by save-signature.
// PASS - LOCAL AUTOMATED (pure rules + source order assertions). Real device behaviour (URL bar, keyboard, rotation, 320-360px
// initials row) is REQUIRES HOSTED DEV VERIFICATION: C-12..C-15, M-02.
import { readFileSync } from 'node:fs';
import { shouldResizeCanvas } from '../../core/canvasResize';
import { invoiceAcceptBlockers, type InvoiceAcceptState } from '../../orders/invoiceAcceptBlockers';
import { invalidSignatureField, parseSignatureDataUrl } from '../../../../supabase/functions/_shared/waiver/signature-validation';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

// --- canvas resize ------------------------------------------------------------------------------------------------------
const box = { width: 320, height: 192, ratio: 2 };
eq('first measurement sizes the canvas', shouldResizeCanvas(null, box), true);
eq('a resize event that changes nothing (URL bar, keyboard) leaves the canvas alone', shouldResizeCanvas(box, { ...box }), false);
eq('sub-pixel noise is ignored', shouldResizeCanvas(box, { ...box, width: 320.3 }), false);
eq('rotation (new width) re-sizes', shouldResizeCanvas(box, { ...box, width: 560 }), true);
eq('zoom / pixel ratio change re-sizes', shouldResizeCanvas(box, { ...box, ratio: 3 }), true);
eq('a hidden (zero-size) canvas is never re-sized', shouldResizeCanvas(box, { ...box, width: 0 }), false);
const pad = read('src/components/waiver/SignaturePad.tsx');
ok('pad keeps the drawn strokes across a real resize (toData before, fromData after)', pad.indexOf('signaturePad.toData()') > 0 && pad.indexOf('signaturePad.toData()') < pad.indexOf('signaturePad.clear()') && pad.indexOf('signaturePad.clear()') < pad.indexOf('signaturePad.fromData('));
ok('pad tells the parent the redrawn image after a resize', /fromData\(strokes\);[\s\S]{0,200}onChangeRef\.current\(signaturePad\.toDataURL/.test(pad));
ok('pad is built once: the parent callback lives in a ref, so a re-render cannot wipe the drawing', /\}, \[\]\);/.test(pad) && /onChangeRef\.current = onSignatureChange/.test(pad));
ok('clearing the pad still resets the parent', /onSignatureChange\(null\)/.test(pad));

// --- Admin Invoice: what is still needed --------------------------------------------------------------------------------
const base: InvoiceAcceptState = {
  processing: false, isNoCardRequired: false, isCardSetupOnly: false, cardOnFileConsent: true, smsConsent: true, nextDayPickup: false,
  overnightResponsibilityAccepted: false, paymentAmount: 'deposit', customPaymentAmount: '', needsCustomerInfo: false, customerInfo: {},
  howDidYouHearEnabled: false, referralAlreadyCaptured: false, referralSource: '',
};
eq('nothing missing: the button is enabled', invoiceAcceptBlockers(base), []);
eq('no card consent', invoiceAcceptBlockers({ ...base, cardOnFileConsent: false }), ['Permission to keep your card on file']);
eq('card consent is not needed when no card is required', invoiceAcceptBlockers({ ...base, cardOnFileConsent: false, isNoCardRequired: true }), []);
eq('no SMS consent', invoiceAcceptBlockers({ ...base, smsConsent: false }), ['Permission to text you about your order']);
eq('overnight agreement is needed only for next-day pickup', [invoiceAcceptBlockers({ ...base, nextDayPickup: true }), invoiceAcceptBlockers({ ...base, nextDayPickup: false })], [['The overnight responsibility agreement'], []]);
eq('custom amount missing', invoiceAcceptBlockers({ ...base, paymentAmount: 'custom' }), ['The payment amount you want to pay today']);
eq('custom amount is irrelevant for a card-on-file-only invoice', invoiceAcceptBlockers({ ...base, paymentAmount: 'custom', isCardSetupOnly: true }), []);
eq('missing contact fields are named', invoiceAcceptBlockers({ ...base, needsCustomerInfo: true, customerInfo: { first_name: 'A', email: 'a@b.test' } }), ['Your contact details (last name, phone)']);
eq('referral source needed only when asked and not already captured', [invoiceAcceptBlockers({ ...base, howDidYouHearEnabled: true }), invoiceAcceptBlockers({ ...base, howDidYouHearEnabled: true, referralAlreadyCaptured: true }), invoiceAcceptBlockers({ ...base, howDidYouHearEnabled: true, referralSource: 'google' })], [['How you heard about us'], [], []]);
eq('several missing items are all listed, in the order the form shows them', invoiceAcceptBlockers({ ...base, cardOnFileConsent: false, smsConsent: false, nextDayPickup: true }), ['The overnight responsibility agreement', 'Permission to keep your card on file', 'Permission to text you about your order']);

// --- screens: order of controls ----------------------------------------------------------------------------------------
const tab = read('src/components/waiver/WaiverTab.tsx');
ok('WaiverTab: the Sign action comes before the blank-waiver Download PDF card', tab.indexOf('Sign Waiver Now') > 0 && tab.indexOf('Sign Waiver Now') < tab.indexOf('Download Blank Waiver'));
ok('WaiverTab: a failed status request shows a message and Try again, not "Waiver Required"', /setStatusError\(true\)/.test(tab) && /We couldn't check your waiver status/.test(tab) && tab.indexOf('if (statusError)') < tab.indexOf('const waiverType'));
const inv = read('src/components/customer-portal/InvoiceAcceptanceView.tsx');
const acceptAt = inv.indexOf('disabled={processing || acceptBlockers.length > 0}');
ok('Invoice: Accept is disabled by the same list the customer sees', acceptAt > 0 && /invoiceAcceptBlockers\(\{/.test(inv));
ok('Invoice: the "still needed" list sits under Accept, then Print, then the Cancel link', inv.indexOf('Still needed before you can accept') > acceptAt && inv.indexOf('Print / Save PDF') > inv.indexOf('Still needed before you can accept') && inv.indexOf('Cancel this order') > inv.indexOf('Print / Save PDF'));
ok('Invoice: Cancel Order is no longer a red block button next to Accept', !/bg-red-50 hover:bg-red-100 text-red-600 font-semibold py-3 px-6/.test(inv));
ok('Invoice: the extra padding is phone-friendly', /p-4 sm:p-8 mt-6 no-print/.test(inv));
const simple = read('src/components/shared/SimpleInvoiceDisplay.tsx');
ok('SimpleInvoiceDisplay: Print is hidden only when the parent says "external" (other screens unchanged)', /printPlacement = 'inline'/.test(simple) && /printPlacement !== 'external'/.test(simple));
ok('Invoice view passes printPlacement="external" and the other users do not', /printPlacement="external"/.test(inv) && !/printPlacement/.test(read('src/pages/InvoicePreview.tsx')) && !/printPlacement/.test(read('src/components/checkout/InvoicePreviewModal.tsx')));
const sign = read('src/pages/Sign.tsx');
ok('Sign: Cancel goes to the portal, not history -1', !/navigate\(-1\)/.test(sign) && /onClick=\{\(\) => navigate\(orderId \? portalPathForCurrentVisitor\(orderId\)/.test(sign));
ok('Sign: a failed submit scrolls the page to the waiver and shows a toast, not only a banner at the bottom', /document\.getElementById\('waiver-section'\)\?\.scrollIntoView/.test(sign) && (sign.match(/notifyError\('Please complete/g) ?? []).length === 2);
ok('WaiverViewer: the initials row wraps on narrow screens', /flex flex-wrap items-center gap-3/.test(read('src/components/waiver/WaiverViewer.tsx')));

// --- signature payload rules (server) -------------------------------------------------------------------------------------
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
ok('a PNG data URL is accepted', parseSignatureDataUrl(PNG).ok === true);
ok('whitespace, wrong prefix, bad base64 and non-PNG bytes are rejected', [' ' + PNG, 'data:image/jpeg;base64,iVBORw0KGgo=', 'data:image/png;base64,@@@@', 'data:image/png;base64,' + Buffer.from('plain text here').toString('base64'), 'data:image/png;base64,', 42, null].every((v) => !parseSignatureDataUrl(v as any).ok));
const good = { signatureDataUrl: PNG, initialsData: { Assumption: 'AA' }, renterName: 'Ann', renterEmail: 'a@b.test', renterPhone: '555', eventDate: '2026-11-10', eventAddressLine1: '1 Main', eventCity: 'Detroit', eventState: 'MI', eventZip: '48201' };
eq('a normal payload has no invalid field', invalidSignatureField(good), null);
eq('initials may be empty strings per section but must be short text', [invalidSignatureField({ ...good, initialsData: {} }), invalidSignatureField({ ...good, initialsData: { A: 'x'.repeat(9) } })], [null, 'initialsData']);
eq('too many initials sections', invalidSignatureField({ ...good, initialsData: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`S${i}`, 'AA'])) }), 'initialsData');
eq('email shape', invalidSignatureField({ ...good, renterEmail: 'nope' }), 'renterEmail');
eq('date shape', invalidSignatureField({ ...good, eventDate: 'next week' }), 'eventDate');
eq('optional fields may be absent', invalidSignatureField({ ...good, eventEndDate: undefined, typedName: undefined, waiverText: undefined, electronicConsentText: undefined }), null);
eq('huge waiver text is refused', invalidSignatureField({ ...good, waiverText: 'x'.repeat(200_001) }), 'waiverText');

console.log(`waiverInvoiceClient: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} waiver/invoice client test(s) failed`);
