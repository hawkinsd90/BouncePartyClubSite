// The customer portal's card-saved invoice fallback (invoice_card_saved_fallback) must not swallow a refused confirmation.
// Behavioural: confirmAfterCardSave (the pure decision the portal uses) with fake lifecycle answers. Source-level (labelled): CustomerPortal
// uses it and no longer ignores the lifecycle answer; no payment call is made in the fallback branch.
import { readFileSync } from 'node:fs';
import { confirmAfterCardSave, CARD_SAVED_CONFIRM_FAILED_MESSAGE, isAvailabilityRefusal } from '../../orders/lifecycleRefusal';

let passed = 0;
let failed = 0;
const ok = (label: string, cond: boolean) => { if (cond) passed++; else { failed++; console.error(`FAIL: ${label}`); } };
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

(async () => {
  const stock = 'ZZ TEST Castle is not available on your event date.';
  const conflict = await confirmAfterCardSave(async () => ({ success: false, code: 'AVAILABILITY_CONFLICT', error: stock }));
  ok('AVAILABILITY_CONFLICT: not confirmed, shows the server equipment message', !conflict.confirmed && conflict.message === stock);
  const unverifiable = await confirmAfterCardSave(async () => ({ success: false, code: 'AVAILABILITY_UNVERIFIABLE', error: 'We could not verify ZZ TEST Castle.' }));
  ok('AVAILABILITY_UNVERIFIABLE: not confirmed, shows the server message', !unverifiable.confirmed && unverifiable.message === 'We could not verify ZZ TEST Castle.');
  const other = await confirmAfterCardSave(async () => ({ success: false, error: 'internal detail that must not reach the customer' }));
  ok('other refusal: not confirmed, generic message (no server internals)', !other.confirmed && other.message === CARD_SAVED_CONFIRM_FAILED_MESSAGE);
  const codeNoMessage = await confirmAfterCardSave(async () => ({ success: false, code: 'AVAILABILITY_CONFLICT' }));
  ok('stock code without a message falls back to the generic message, still not confirmed', !codeNoMessage.confirmed && codeNoMessage.message === CARD_SAVED_CONFIRM_FAILED_MESSAGE && !isAvailabilityRefusal({ success: false, code: 'AVAILABILITY_CONFLICT' }));
  const thrown = await confirmAfterCardSave(async () => { throw new Error('network down'); });
  ok('a thrown error is not success and is not rethrown', !thrown.confirmed && thrown.message === CARD_SAVED_CONFIRM_FAILED_MESSAGE);
  const good = await confirmAfterCardSave(async () => ({ success: true }));
  ok('success confirms with no message', good.confirmed && good.message === null);
  const already = await confirmAfterCardSave(async () => ({ success: false, alreadySent: true }));
  ok('alreadySent (already confirmed earlier) counts as confirmed, no duplicate error', already.confirmed);

  const portal = read('src/pages/CustomerPortal.tsx');
  const fallback = portal.slice(portal.indexOf('invoice_card_saved_fallback') - 400, portal.indexOf('invoice_card_saved_fallback') + 1100);
  ok('source-level: the portal fallback uses confirmAfterCardSave and returns before the success view when not confirmed', /confirmAfterCardSave\(/.test(fallback) && /if \(!confirmation\.confirmed\) \{[\s\S]*?showToast\([\s\S]*?'error'[\s\S]*?return;/.test(fallback));
  ok('source-level: the fallback no longer swallows lifecycle errors as "non-fatal"', !/order-lifecycle fallback failed \(non-fatal\)/.test(portal));
  ok('source-level: the fallback branch makes no payment call (charge-deposit / stripe) of its own', !/charge-deposit|stripe/i.test(fallback.slice(fallback.indexOf('confirmAfterCardSave'))));

  console.log(`card-saved confirmation tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
