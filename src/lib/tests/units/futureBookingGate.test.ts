// futureBookingGate: the decision an Admin goes through before a unit is deleted or deactivated (none / found / unknown), with the dialog injected.
// The same flow through the real screens is executed in unitDeleteFlow.test.ts; this file pins the messages and the loop.
import { confirmUnitAction, futureBookingWarning, verificationFailedMessage, RETRY_CHECK_OPTIONS, type ConfirmFn } from '../../units/futureBookingGate';
import type { FutureBooking, FutureBookingCheck } from '../../units/futureBooking';

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
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(want)}`);
  }
}

const booking = (n: number): FutureBooking => ({
  order_id: `o${n}`,
  orders: { id: `a1b2c3d4-0000-4000-8000-00000000000${n}`, event_date: `2030-06-0${n}`, event_end_date: null, status: 'confirmed', customers: { first_name: 'Ann', last_name: 'Lee' } },
});

function script(results: FutureBookingCheck[], answers: boolean[]) {
  const asked: Array<{ message: string; options?: unknown }> = [];
  let checks = 0;
  const confirm: ConfirmFn = (message, options) => {
    asked.push({ message, options });
    return Promise.resolve(answers.length ? (answers.shift() as boolean) : false);
  };
  const check = () => Promise.resolve(results[Math.min(checks++, results.length - 1)]);
  return { asked, confirm, check, get checks() { return checks; } };
}

async function main() {
  // --- messages ---
  eq('warning, delete, one booking', futureBookingWarning('Castle', 'delete', [booking(1)]),
    'WARNING: "Castle" has 1 future booking(s)!\n\n• Order #A1B2C3D4 - Ann Lee on 2030-06-01\n\nDeleting this unit may cause issues with these orders. Are you sure you want to continue?');
  ok('warning, deactivate uses the inactive wording', /Marking this unit as inactive may cause issues with these orders\./.test(futureBookingWarning('Castle', 'deactivate', [booking(1)])));
  const seven = Array.from({ length: 7 }, (_, i) => booking((i % 9) + 1));
  const w7 = futureBookingWarning('Castle', 'delete', seven);
  ok('warning, seven bookings: count, five listed, "...and 2 more"', /has 7 future booking\(s\)!/.test(w7) && (w7.match(/• Order #/g) ?? []).length === 5 && w7.includes('\n...and 2 more\n'));
  const failedDelete = verificationFailedMessage('Castle', 'delete', 'Failed to fetch');
  ok('failed check, delete: says what failed, that nothing changed, that deleting is blocked, and how to proceed', failedDelete.includes('Could not check "Castle" for future bookings (Failed to fetch)') && failedDelete.includes('Nothing has been changed') && failedDelete.includes('deleting it is blocked until the check succeeds') && failedDelete.includes('try again'));
  ok('failed check, deactivate wording', verificationFailedMessage('Castle', 'deactivate', 'x').includes('deactivating it is blocked'));
  eq('the retry dialog offers Try again / Cancel', RETRY_CHECK_OPTIONS, { confirmText: 'Try again', cancelText: 'Cancel', type: 'warning' });

  // --- delete ---
  let s = script([{ status: 'none' }], [true]);
  ok('delete, none, confirmed -> may proceed (one ordinary question)', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === true && s.asked.length === 1 && s.asked[0].message === 'Are you sure you want to delete "Castle"?');
  s = script([{ status: 'none' }], [false]);
  ok('delete, none, cancelled -> may not proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === false);
  s = script([{ status: 'found', bookings: [booking(1), booking(2)] }], [true]);
  ok('delete, found, confirmed -> may proceed after the WARNING', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === true && /has 2 future booking\(s\)!/.test(s.asked[0].message));
  s = script([{ status: 'found', bookings: [booking(1)] }], [false]);
  ok('delete, found, cancelled -> may not proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === false);

  // --- unknown never proceeds ---
  s = script([{ status: 'unknown', error: 'boom' }], [false]);
  ok('delete, unknown, Cancel -> may not proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === false && s.asked.length === 1 && s.checks === 1);
  s = script([{ status: 'unknown', error: 'boom' }], [true, true, true, false]);
  ok('delete, unknown, Try again x3 still failing then Cancel -> never proceeds; 4 checks, 4 failure messages, no ordinary question', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === false && s.checks === 4 && s.asked.length === 4 && s.asked.every((a) => /Could not check/.test(a.message)));
  s = script([{ status: 'unknown', error: 'boom' }, { status: 'none' }], [true, true]);
  ok('delete, unknown then Try again succeeds with none -> ordinary question, then may proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === true && s.checks === 2 && s.asked[1].message === 'Are you sure you want to delete "Castle"?');
  s = script([{ status: 'unknown', error: 'boom' }, { status: 'found', bookings: [booking(1)] }], [true, false]);
  ok('delete, unknown then found, Cancel -> may not proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'delete', check: s.check, ask: s.confirm })) === false && /future booking/.test(s.asked[1].message));

  // --- deactivate ---
  s = script([{ status: 'none' }], []);
  ok('deactivate, none -> may proceed with no question', (await confirmUnitAction({ unitName: 'Castle', action: 'deactivate', check: s.check, ask: s.confirm })) === true && s.asked.length === 0);
  s = script([{ status: 'found', bookings: [booking(1)] }], [false]);
  ok('deactivate, found, cancelled -> may not proceed', (await confirmUnitAction({ unitName: 'Castle', action: 'deactivate', check: s.check, ask: s.confirm })) === false);
  s = script([{ status: 'unknown', error: 'timed out' }], [false]);
  ok('deactivate, unknown -> blocked', (await confirmUnitAction({ unitName: 'Castle', action: 'deactivate', check: s.check, ask: s.confirm })) === false);

  console.log(`futureBookingGate: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} future booking gate test(s) failed`);
}
main();
