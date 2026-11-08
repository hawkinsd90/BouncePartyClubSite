// WP-P2-19 (F-38): is the customer's cart emptied after a booking request? BEHAVIOURAL test of the REAL useBookingReturnConfirmation hook
// (src/hooks/booking/useBookingReturnConfirmation.ts, the hook behind /payment-complete) driven with the repository's hooks runner and a scripted
// booking API, notification call and in-memory storage. It asserts WHEN bpc_cart is removed, not only that it eventually is.
// PASS - LOCAL AUTOMATED behavioural. A real browser / Stripe return (NT-32) is NOT RUN.
/* eslint-disable @typescript-eslint/no-explicit-any -- scripted collaborators */
import { runHook, loadModuleWithMocks } from '../support/hookHarness';

declare const require: (id: string) => any;

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

interface Script {
  load: Array<() => Promise<any>>; // loadCompletedBooking calls in order (the last one repeats)
  notify: () => Promise<any>;
  alreadyProcessed?: boolean;
}

function order(status: string) {
  return {
    order: { id: 'ZZ-TEST-ORDER', status, event_date: '2030-01-01', customer: { first_name: 'ZZ', last_name: 'TEST', email: 'zz-test@example.invalid' } },
    isAdminInvoice: false,
    tipCents: 0,
  };
}

function build(script: Script) {
  const fs = require('fs');
  const store = new Map<string, string>([['bpc_cart', '[{"unit":"ZZ TEST"}]'], ['bpc_quote_form', '{}']]);
  if (script.alreadyProcessed) store.set('payment_processed_ZZ-TEST-ORDER', 'true');
  const events: string[] = [];
  let loadCalls = 0;
  (globalThis as any).window = { dispatchEvent: (e: any) => events.push(e.type) };
  (globalThis as any).CustomEvent = class { type: string; constructor(t: string) { this.type = t; } };
  const mocks: Record<string, unknown> = {
    react: require('react'),
    '../../lib/booking/bookingApi': {
      loadCompletedBooking: () => {
        const i = Math.min(loadCalls, script.load.length - 1);
        loadCalls++;
        return script.load[i]();
      },
    },
    '../../lib/booking/bookingAttempt': { clearBookingAttempt: () => { store.delete('bpc_attempt'); } },
    '../../lib/core/safeStorage': {
      SafeStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    },
    '../../lib/notifications/orderNotificationService': { sendCustomerBookingConfirmationNotifications: () => script.notify() },
    '../../lib/constants/statuses': { ORDER_STATUS: { DRAFT: 'draft' } },
    '../../lib/booking/confirmationRetry': require('../../booking/confirmationRetry'),
    '../../lib/core/errorLike': require('../../core/errorLike'),
  };
  // import.meta.env does not exist when the hook is evaluated as CommonJS; it is read only on the draft-recovery path (a fetch URL).
  const patched = fs.readFileSync('src/hooks/booking/useBookingReturnConfirmation.ts', 'utf8').replace(/import\.meta\.env/g, '({})');
  const tmp = require('os').tmpdir() + '/useBookingReturnConfirmation.patched.ts';
  fs.writeFileSync(tmp, patched);
  const mod = loadModuleWithMocks(tmp, mocks);
  const run = runHook(() => mod.useBookingReturnConfirmation('ZZ-TEST-ORDER', 'cs_test_zz'), undefined as any);
  return { run, store, events };
}

const cartLeft = (s: Map<string, string>) => s.has('bpc_cart');

async function main() {
  // 1. Normal: loaded, notification succeeds -> cart cleared, success.
  {
    const w = build({ load: [async () => order('pending_review')], notify: async () => ({ emailSent: true, emailError: null }) });
    await w.run.settle(10);
    ok('normal: status success', w.run.result.status === 'success');
    ok('normal: cart cleared', !cartLeft(w.store));
    ok('normal: quote form cleared', !w.store.has('bpc_quote_form'));
    ok('normal: bpc-cart-updated dispatched', w.events.includes('bpc-cart-updated'));
  }

  // 2. Notification call still in flight (slow network) while the customer presses Back / leaves: the order IS a real submitted
  //    request, so the cart must already be empty.
  {
    let release: (v: any) => void = () => {};
    const w = build({ load: [async () => order('pending_review')], notify: () => new Promise((r) => { release = r; }) });
    await w.run.settle(10);
    ok('slow notification: page still loading (notification pending)', w.run.result.status === 'loading');
    ok('slow notification: cart already cleared before the notification returns', !cartLeft(w.store));
    release({ emailSent: true, emailError: null });
    await w.run.settle(10);
    ok('slow notification: ends in success and cart still empty', w.run.result.status === 'success' && !cartLeft(w.store));
  }

  // 3. Notification step rejects unexpectedly (the service normally catches, but a rejected promise must not leave the cart full).
  {
    const w = build({ load: [async () => order('pending_review')], notify: async () => { throw new Error('ZZ boom'); } });
    await w.run.settle(10);
    ok('notification throws: cart cleared although the booking exists', !cartLeft(w.store));
  }

  // 4. Notification reports email not sent (recoverable): booking is complete, cart cleared.
  {
    const w = build({ load: [async () => order('pending_review')], notify: async () => ({ emailSent: false, emailError: 'x' }) });
    await w.run.settle(10);
    ok('email not sent: cart cleared', !cartLeft(w.store));
  }

  // 5. Reopening the success URL (visit already processed): cart cleared.
  {
    const w = build({ load: [async () => order('pending_review')], notify: async () => ({ emailSent: true }), alreadyProcessed: true });
    await w.run.settle(10);
    ok('reopen success URL: cart cleared', !cartLeft(w.store));
  }

  // 6. Guard: load returns nothing -> cart is NOT removed (the booking is not known to exist).
  {
    const w = build({ load: [async () => null], notify: async () => ({ emailSent: true }) });
    await w.run.settle(100); // three attempts with a one second wait between them
    ok('load fails: status error', w.run.result.status === 'error');
    ok('load fails: cart NOT cleared', cartLeft(w.store));
  }

  // 7. Guard: load throws -> cart NOT removed.
  {
    const w = build({ load: [async () => { throw new Error('ZZ net'); }], notify: async () => ({ emailSent: true }) });
    await w.run.settle(10);
    ok('load throws: cart NOT cleared', cartLeft(w.store));
  }

  console.log(`cartClearAfterBooking: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
