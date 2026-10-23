// useInvoiceEventDetails: the 19:00 end-time cap for same-day (residential) and commercial invoices.
// The cap is applied when the pickup preference, the location type or the event date CHANGES. It is not applied again when the end time is edited
// afterwards, and the Admin editor's End Time picker has no maximum, so an Admin can still enter a later end time. These tests record that behavior
// exactly (REPRODUCED, not changed): whether the 19:00 limit should bind staff-entered invoices is a business decision (the customer Quote screen
// does cap the input), so the dependency list is left as it is and the lint warning stays visible. See the hook-dependency policy test.
import { readFileSync } from 'node:fs';
import { runHook } from '../../lib/tests/support/hookHarness';
import { useInvoiceEventDetails } from './useInvoiceEventDetails';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

const mount = () => runHook(() => useInvoiceEventDetails(), undefined);

// 1. switching to same-day pickup caps a later end time to 19:00
{
  const run = mount();
  run.result.updateEventDetails({ event_date: '2031-07-04', end_window: '21:00' });
  run.rerender();
  ok('residential next-day: a 21:00 end time is allowed', run.result.eventDetails.end_window === '21:00');
  run.result.updateEventDetails({ pickup_preference: 'same_day' });
  run.rerender();
  ok('switching to same-day pickup caps the end time to 19:00', run.result.eventDetails.end_window === '19:00');
  ok('...and ends the event on the start date', run.result.eventDetails.event_end_date === '2031-07-04' && run.result.eventDetails.until_end_of_day === false);
}

// 2. an earlier end time is left alone
{
  const run = mount();
  run.result.updateEventDetails({ event_date: '2031-07-04', end_window: '15:30', pickup_preference: 'same_day' });
  run.rerender();
  ok('an end time before 19:00 is not changed', run.result.eventDetails.end_window === '15:30');
}

// 3. REPRODUCED: an end time edited AFTER the switch is not capped again
{
  const run = mount();
  run.result.updateEventDetails({ event_date: '2031-07-04', pickup_preference: 'same_day' });
  run.rerender();
  run.result.updateEventDetails({ end_window: '21:00' });
  run.rerender();
  ok('same-day: an end time edited after the switch stays at 21:00 (the cap is not re-applied on an end_window edit)', run.result.eventDetails.end_window === '21:00');
  const commercial = mount();
  commercial.result.updateEventDetails({ event_date: '2031-07-04', location_type: 'commercial' });
  commercial.rerender();
  commercial.result.updateEventDetails({ end_window: '22:00' });
  commercial.rerender();
  ok('commercial: the same holds for a later edit', commercial.result.eventDetails.end_window === '22:00');
  // a later change of the event date applies the cap again (that is when the effect re-runs)
  commercial.result.updateEventDetails({ event_date: '2031-07-05' });
  commercial.rerender();
  ok('commercial: changing the event date afterwards caps it to 19:00', commercial.result.eventDetails.end_window === '19:00');
}

// 4. the Admin editor's End Time picker has no maximum (so the case above is reachable from the screen)
{
  const editor = readFileSync('src/components/order-detail/EventDetailsEditor.tsx', 'utf8').replace(/\r\n/g, '\n');
  const m = /<TimePickerInput\s+value=\{editedOrder\.end_window\}[\s\S]*?\/>/.exec(editor);
  ok('the EventDetailsEditor End Time picker is found and has no max', !!m && !/\bmax=/.test(m[0]));
  const quote = readFileSync('src/components/quote/EventDetailsSection.tsx', 'utf8');
  ok('the customer Quote screen DOES cap its end-time input at 19:00 for same-day / commercial', /max=\{isSameDayRestricted \? '19:00' : undefined\}/.test(quote));
}

console.log(`useInvoiceEventDetails: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} useInvoiceEventDetails test(s) failed`);
