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
// Admin / Master: may approve the exception (D5). Crew gets no authority: see the Crew block below.
const mount = (s: Staff) => runHook(() => useInvoiceEventDetails({ canApproveEndWindowException: true, confirmEndWindowException: s.confirm }), undefined);

async function main() {
  // --- pure rule ---
  ok('the limit is the Quote\'s 19:00', SAME_DAY_LATEST_END_TIME === '19:00');
  ok('restricted: residential same-day and commercial; not residential next-day', isEndWindowRestricted({ location_type: 'residential', pickup_preference: 'same_day' }) && isEndWindowRestricted({ location_type: 'commercial', pickup_preference: 'next_day' }) && !isEndWindowRestricted({ location_type: 'residential', pickup_preference: 'next_day' }));
  const base = { location_type: 'commercial', pickup_preference: 'same_day', confirmedEndWindow: null };
  ok('rule: 19:00 and earlier never need confirmation; later does; the confirmed exact time does not', !needsEndWindowConfirmation({ ...base, end_window: '19:00' }) && !needsEndWindowConfirmation({ ...base, end_window: '15:30' }) && needsEndWindowConfirmation({ ...base, end_window: '19:01' }) && !needsEndWindowConfirmation({ ...base, end_window: '21:00', confirmedEndWindow: '21:00' }) && needsEndWindowConfirmation({ ...base, end_window: '22:00', confirmedEndWindow: '21:00' }));
  ok('rule: declining returns to the last accepted time, or to 19:00 when that is no longer allowed', endWindowAfterDecline({ ...base, lastAcceptedEndWindow: '17:00' }) === '17:00' && endWindowAfterDecline({ ...base, lastAcceptedEndWindow: '21:00' }) === '19:00');

  // --- WP-P2-12a (F-34): a new invoice starts with BLANK times (no invented 9:00 AM / 5:00 PM) ---
  {
    const s = staff();
    const run = mount(s);
    await run.settle();
    ok('a new invoice starts with a blank start and end time', run.result.eventDetails.start_window === '' && run.result.eventDetails.end_window === '');
    ok('blank times raise no end-time question', s.asked.length === 0);
    run.result.updateEventDetails({ event_date: '2031-07-04', start_window: '10:00', end_window: '14:00' });
    await run.settle();
    run.result.resetEventDetails();
    await run.settle();
    ok('resetting after an invoice goes back to blank times, not to defaults', run.result.eventDetails.start_window === '' && run.result.eventDetails.end_window === '');
    // a declined exception with no earlier accepted time clears back to blank, never to an invented time
    const s2 = staff([false]);
    const run2 = mount(s2);
    run2.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '21:00' });
    await run2.settle();
    ok('declining an after-7-PM exception when no time was accepted before returns to blank (staff choose again), never to an invented 17:00', run2.result.eventDetails.end_window === '' && s2.asked.length === 1);
    // intentional times are never silently replaced
    const s3 = staff();
    const run3 = mount(s3);
    run3.result.updateEventDetails({ event_date: '2031-07-04', start_window: '08:15', end_window: '11:45' });
    await run3.settle();
    run3.result.updateEventDetails({ address_line1: '1 ZZ TEST St' });
    await run3.settle();
    ok('chosen times survive other edits unchanged', run3.result.eventDetails.start_window === '08:15' && run3.result.eventDetails.end_window === '11:45');
  }

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

  // --- D5 (WP-P2-25): Crew gets NO exception authority; a user who cannot approve is told why and the time is refused ---
  {
    const told: string[] = [];
    const asked: string[] = [];
    const mountCrew = () => runHook(() => useInvoiceEventDetails({ confirmEndWindowException: (m: string) => { asked.push(m); return Promise.resolve(true); }, onEndWindowRefused: (m: string) => { told.push(m); } }), undefined);
    const run = mountCrew();
    run.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '16:00' });
    await run.settle();
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    ok('Crew (default, no approval authority): a 21:00 same-day end is refused, never offered a confirmation', asked.length === 0 && told.length === 1 && /21:00/.test(told[0]) && /Only an Admin/.test(told[0]));
    ok('Crew: the refused time goes back to the last accepted time (16:00) and no exception is confirmed', run.result.eventDetails.end_window === '16:00' && run.result.endWindowExceptionConfirmed === false);
    run.result.updateEventDetails({ end_window: '21:00' });
    await run.settle();
    ok('Crew: entering the same refused time again is refused again', told.length === 2 && run.result.eventDetails.end_window === '16:00');
    const run2 = mountCrew();
    run2.result.updateEventDetails({ event_date: '2031-07-04', location_type: 'commercial', end_window: '20:00' });
    await run2.settle();
    ok('Crew: a commercial rental after 19:00 is refused too (blank when nothing was accepted before, never an invented time)', run2.result.eventDetails.end_window === '' && asked.length === 0);
    const run3 = mountCrew();
    run3.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '19:00' });
    await run3.settle();
    ok('Crew: exactly 19:00 is a normal time, and a residential next-day 21:00 is allowed (overnight bookings not broken)', run3.result.eventDetails.end_window === '19:00');
    const run4 = mountCrew();
    run4.result.updateEventDetails({ event_date: '2031-07-04', end_window: '21:00' });
    await run4.settle();
    ok('Crew: next-day residential 21:00 raises neither a refusal nor a question', run4.result.eventDetails.end_window === '21:00' && told.length === 3 && asked.length === 0);
    // Admin: the confirmation yields the flag the builder sends; declining yields nothing
    const s = staff([true]);
    const admin = mount(s);
    admin.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '21:00' });
    await admin.settle();
    ok('Admin: confirming exposes endWindowExceptionConfirmed for exactly that time', admin.result.endWindowExceptionConfirmed === true && admin.result.eventDetails.end_window === '21:00');
    admin.result.updateEventDetails({ end_window: '18:00' });
    await admin.settle();
    ok('Admin: back inside the window clears the confirmed flag', admin.result.endWindowExceptionConfirmed === false);
    const s2 = staff([false]);
    const declined = mount(s2);
    declined.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day', end_window: '21:00' });
    await declined.settle();
    ok('Admin: cancelling the warning keeps nothing (time reverted, no flag, so nothing can be saved with the exception)', declined.result.endWindowExceptionConfirmed === false && declined.result.eventDetails.end_window === '');
    // The default stays safe: no option at all means no authority
    ok('source-level: the hook defaults to NO approval authority', /options\.canApproveEndWindowException === true/.test(readFileSync('src/hooks/invoices/useInvoiceEventDetails.ts', 'utf8')));
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
      const src = readFileSync(f, 'utf8');
      const admin = f.includes('admin/');
      ok(`${f} gets its end-time rule through useInvoiceEventDetails (${admin ? 'Admin: may approve, role from useAuth' : 'Crew: no override option'})`, admin ? /useInvoiceEventDetails\(\{ canApproveEndWindowException: isAdmin \}\)/.test(src) && /endWindowExceptionConfirmed/.test(src) : /useInvoiceEventDetails\(\)/.test(src) && !/canApproveEndWindowException|endWindowExceptionConfirmed/.test(src));
    }
    const hook = readFileSync('src/hooks/invoices/useInvoiceEventDetails.ts', 'utf8');
    ok('the hook no longer silently cuts the end time to 19:00', !/'19:00'/.test(hook) && !/cappedEndWindow/.test(hook));
  }

  console.log(`useInvoiceEventDetails: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} useInvoiceEventDetails test(s) failed`);
}
main();
