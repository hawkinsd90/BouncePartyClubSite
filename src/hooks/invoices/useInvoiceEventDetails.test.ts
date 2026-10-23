// useInvoiceEventDetails: end times after 19:00 on same-day (residential) and commercial STAFF invoices (approved direction: preserve Admin
// flexibility). The customer Quote screen limits these rentals to a 19:00 end time and is unchanged. On a staff invoice a later end time is
// allowed, but only after a clear warning and an explicit confirmation of that exact time; the confirmed time is kept (and saved as entered); an
// unchanged confirmed exception is not asked about again; editing the time evaluates it afresh; declining goes back to the last accepted time.
// Before this change the hook silently cut a later time to 19:00 when the rental type changed (overwriting an intentional Admin time) and did not
// look at the time at all when it was edited. PASS - LOCAL AUTOMATED (the real hook through the hook runner, a stubbed confirmation dialog).
import { readFileSync } from 'node:fs';
import { runHook, loadModuleWithMocks } from '../../lib/tests/support/hookHarness';
import * as endWindowRules from '../../lib/core/endWindowExceptions';
import { SAME_DAY_LATEST_END_TIME, endWindowAfterDecline, isEndWindowRestricted, needsEndWindowConfirmation } from '../../lib/core/endWindowExceptions';

// The real hook source; the app's confirmation dialog (a DOM widget) is replaced by the stub each test passes in.
const { useInvoiceEventDetails } = loadModuleWithMocks('src/hooks/invoices/useInvoiceEventDetails.ts', {
  '../../lib/toasts': { showConfirm: () => Promise.resolve(false) },
  '../../lib/core/endWindowExceptions': endWindowRules,
});

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

interface Staff {
  asked: string[];
  answer: (keep: boolean) => void;
  confirm: (message: string) => Promise<boolean>;
}
// A stand-in for the confirmation dialog: records each question and resolves with the next scripted answer.
function staff(answers: boolean[] = []): Staff {
  const asked: string[] = [];
  let resolveNext: ((v: boolean) => void) | null = null;
  const queue = [...answers];
  return {
    asked,
    answer: (keep) => resolveNext?.(keep),
    confirm: (message) => {
      asked.push(message);
      if (queue.length > 0) return Promise.resolve(queue.shift() as boolean);
      return new Promise<boolean>((resolve) => { resolveNext = resolve; });
    },
  };
}
const mount = (s: Staff) => runHook(() => useInvoiceEventDetails({ confirmEndWindowException: s.confirm }), undefined);

async function main() {
  // --- pure rule ---
  ok('the limit is the Quote\'s 19:00', SAME_DAY_LATEST_END_TIME === '19:00');
  ok('restricted: residential same-day and commercial; not residential next-day', isEndWindowRestricted({ location_type: 'residential', pickup_preference: 'same_day' }) && isEndWindowRestricted({ location_type: 'commercial', pickup_preference: 'next_day' }) && !isEndWindowRestricted({ location_type: 'residential', pickup_preference: 'next_day' }));
  const base = { location_type: 'commercial', pickup_preference: 'same_day', confirmedEndWindow: null };
  ok('rule: 19:00 and earlier never need confirmation; later does; the confirmed exact time does not', !needsEndWindowConfirmation({ ...base, end_window: '19:00' }) && !needsEndWindowConfirmation({ ...base, end_window: '15:30' }) && needsEndWindowConfirmation({ ...base, end_window: '19:01' }) && !needsEndWindowConfirmation({ ...base, end_window: '21:00', confirmedEndWindow: '21:00' }) && needsEndWindowConfirmation({ ...base, end_window: '22:00', confirmedEndWindow: '21:00' }));
  ok('rule: declining returns to the last accepted time, or to 19:00 when that is no longer allowed', endWindowAfterDecline({ ...base, lastAcceptedEndWindow: '17:00' }) === '17:00' && endWindowAfterDecline({ ...base, lastAcceptedEndWindow: '21:00' }) === '19:00');

  // --- normal times: no prompt ---
  {
    const s = staff();
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', end_window: '21:00' });
    await run.settle();
    ok('residential next-day: a 21:00 end time is allowed without a question', run.result.eventDetails.end_window === '21:00' && s.asked.length === 0);
    const s2 = staff();
    const run2 = mount(s2);
    run2.result.updateEventDetails({ event_date: '2031-07-04', end_window: '15:30', pickup_preference: 'same_day' });
    await run2.settle();
    ok('same-day: 15:30 and exactly 19:00 are normal times (no question)', run2.result.eventDetails.end_window === '15:30' && s2.asked.length === 0);
    run2.result.updateEventDetails({ end_window: '19:00' });
    await run2.settle();
    ok('...19:00 itself is within the window', run2.result.eventDetails.end_window === '19:00' && s2.asked.length === 0);
  }

  // --- a later time on a restricted rental: warning, then confirmation keeps it ---
  {
    const s = staff([true]);
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    ok('same-day: a 21:00 end time asks exactly once, naming the time and the normal limit', s.asked.length === 1 && /21:00/.test(s.asked[0]) && /19:00/.test(s.asked[0]) && /outside the normal customer booking window/.test(s.asked[0]));
    ok('confirmation keeps the entered time', run.result.eventDetails.end_window === '21:00');
    ok('the saved details (the object the builder saves) hold the confirmed time and the same-day dates', run.result.eventDetails.end_window === '21:00' && run.result.eventDetails.event_end_date === '2031-07-04' && run.result.eventDetails.until_end_of_day === false);
    // an unchanged confirmed exception is not asked about again (re-renders, other field edits, a date change)
    run.rerender();
    run.result.updateEventDetails({ address_line1: '1 Main St' });
    await run.settle();
    run.result.updateEventDetails({ event_date: '2031-07-05' });
    await run.settle();
    ok('an unchanged confirmed exception is not asked about again (re-render, other edits, event date change)', s.asked.length === 1 && run.result.eventDetails.end_window === '21:00');
    // editing the time evaluates it afresh
    s.asked.length = 0;
    const queued = staff([true, false]);
    void queued;
  }
  {
    const s = staff([true, true]);
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', location_type: 'commercial' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '22:00' });
    await run.settle();
    ok('a subsequent edit to a different later time asks again and keeps it once confirmed', s.asked.length === 2 && /22:00/.test(s.asked[1]) && run.result.eventDetails.end_window === '22:00');
    run.result.updateEventDetails({ end_window: '18:00' });
    await run.settle();
    ok('editing back inside the window asks nothing', s.asked.length === 2 && run.result.eventDetails.end_window === '18:00');
  }
  {
    const s = staff([true, true]);
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', location_type: 'commercial', end_window: '21:00' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '18:00' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    ok('leaving a confirmed exception and entering the same time again is a new edit: it asks again', s.asked.length === 2);
  }

  // --- cancellation ---
  {
    const s = staff([false]);
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '16:00' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    ok('declining goes back to the last accepted time (16:00), not to a silent 19:00', s.asked.length === 1 && run.result.eventDetails.end_window === '16:00');
    s.asked.length = 0;
    run.result.updateEventDetails({ end_window: '16:00' });
    await run.settle();
    ok('...and nothing further is asked', s.asked.length === 0);
  }

  // --- the former silent overwrite: switching the rental type under an existing later time ---
  {
    const s = staff([true]);
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', end_window: '21:00' });
    await run.settle();
    run.result.updateEventDetails({ location_type: 'commercial' });
    await run.settle();
    ok('switching to commercial no longer silently overwrites an intentional 21:00: it asks, and a yes keeps it', s.asked.length === 1 && /21:00/.test(s.asked[0]) && run.result.eventDetails.end_window === '21:00');
    ok('...the same-day dates rule still applies (ends on its start date)', run.result.eventDetails.event_end_date === '2031-07-04' && run.result.eventDetails.until_end_of_day === false);
    const s2 = staff([false]);
    const run2 = mount(s2);
    run2.result.updateEventDetails({ event_date: '2031-07-04', end_window: '21:00' });
    await run2.settle();
    run2.result.updateEventDetails({ location_type: 'commercial' });
    await run2.settle();
    ok('declining after a type switch falls back to the normal 19:00 (21:00 is no longer an allowed accepted time)', run2.result.eventDetails.end_window === '19:00');
  }

  // --- no duplicate dialogs while one is open ---
  {
    const s = staff();
    const run = mount(s);
    run.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '21:00' });
    await run.settle();
    run.rerender();
    run.rerender();
    ok('one open question is not repeated by re-renders', s.asked.length === 1);
    s.answer(true);
    await run.settle();
    ok('...and answering it keeps the time', run.result.eventDetails.end_window === '21:00' && s.asked.length === 1);
  }

  // --- the customer Quote and the staff editors ---
  {
    const quote = readFileSync('src/components/quote/EventDetailsSection.tsx', 'utf8').replace(/\r\n/g, '\n');
    ok('the customer Quote still caps its end-time input at 19:00 for same-day / commercial (unchanged)', /max=\{isSameDayRestricted \? '19:00' : undefined\}/.test(quote) && /newTime > '19:00'/.test(quote));
    const form = readFileSync('src/hooks/booking/useQuoteForm.ts', 'utf8');
    ok('the Quote form still caps the stored end time at 19:00 (unchanged)', /end_window: prev\.end_window > '19:00' \? '19:00' : prev\.end_window/.test(form));
    const editor = readFileSync('src/components/order-detail/EventDetailsEditor.tsx', 'utf8').replace(/\r\n/g, '\n');
    const m = /<TimePickerInput\s+value=\{editedOrder\.end_window\}[\s\S]*?\/>/.exec(editor);
    ok('the staff editor\'s End Time picker still has no maximum (flexibility preserved; the hook asks instead)', !!m && !/\bmax=/.test(m[0]));
    for (const f of ['src/components/admin/invoices/InvoiceBuilder.tsx', 'src/components/crew/CrewInvoiceBuilder.tsx']) {
      ok(`${f} gets the confirmation through useInvoiceEventDetails`, /useInvoiceEventDetails\(\)/.test(readFileSync(f, 'utf8')));
    }
    const hook = readFileSync('src/hooks/invoices/useInvoiceEventDetails.ts', 'utf8');
    ok('the hook no longer silently cuts the end time to 19:00', !/'19:00'/.test(hook) && !/cappedEndWindow/.test(hook));
  }

  console.log(`useInvoiceEventDetails: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} useInvoiceEventDetails test(s) failed`);
}
main();
