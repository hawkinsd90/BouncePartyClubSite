// WP-P1-11 (F-48 end time before start time), WP-P2-12a (F-34 blank times for new invoice / duplicate flows), WP-P2-25 (DEC-06 the customer
// 7:00 PM cap kept consistent between picker and validation) and WP-P1-12 (F-40 saved-address pricing), as pure / behavioural tests:
//   - the shared helper (blank = not yet chosen, same-date strictness, overnight / multi-day stay valid);
//   - the Quote validation, the server booking-input check and the staff invoice path (REAL server functions);
//   - the Edit Order save gate (stored legacy windows are only refused when this save changes them);
//   - the duplicate-order time carry (no invented 9:00 / 17:00);
//   - the saved-address geocode (the Maps-load race is REPRODUCED with a loader that is not ready on the first attempt) and the profile-address update.
// Source-level assertions (reading source text, not rendering) are labelled "source-level".
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import {
  CHOOSE_END_TIME_MESSAGE,
  CHOOSE_START_TIME_MESSAGE,
  END_BEFORE_START_MESSAGE,
  eventWindowProblem,
  isCompleteTime,
  isEndAfterStart,
  isSameDateRental,
  normalizeTime,
} from '../../core/eventTimeWindow';
import { validateQuote } from '../../booking/quoteValidation';
import { validateBookingInput } from '../../../../supabase/functions/_shared/booking/bookingInput';
import { createStaffInvoiceOrder } from '../../../../supabase/functions/_shared/orders/staff-order-save';
import * as windowRules from '../../core/eventTimeWindow';
import * as endWindowRules from '../../core/endWindowExceptions';
import { editNeedsEndWindowExceptionConfirmation } from '../../core/endWindowExceptions';
import * as surfaceChoice from '../../orders/surfaceChoice';
import { loadModuleWithMocks } from '../support/hookHarness';
import { duplicateOrderTimes } from '../../orders/duplicateOrderTimes';
import { CHOOSE_ADDRESS_REASON, quoteContinueState } from '../../booking/quoteContinueBar';
import { geocodeSavedAddress } from '../../booking/savedAddressGeocode';
import { buildProfileAddressUpdate } from '../../../hooks/booking/useQuotePrefill';

const sentToServer: Array<{ action: string; payload: any }> = [];
const toasts: Array<{ message: string; type: string }> = [];
let nextSaveError: Error | null = null;
class FakeStaffOrderSaveError extends Error { code: string; constructor(message: string, code: string) { super(message); this.code = code; } }
// The real Edit Order save module; only its UI / network collaborators are stubbed (it is never asked to save here).
const { editOrderWindowProblem, saveOrderChanges, buildSaveRequest, SaveCancelledError } = loadModuleWithMocks('src/lib/orders/staffOrderSaveRequest.ts', {
  '../toasts': { showToast: (message: string, type: string) => { toasts.push({ message, type }); }, showConfirm: () => Promise.resolve(false) },
  '../core/eventTimeWindow': windowRules,
  '../core/endWindowExceptions': endWindowRules,
  './surfaceChoice': surfaceChoice,
  '../portal/customerPortalRefreshSignal': { notifyPortalRefresh: () => Promise.resolve() },
  // Records what would be sent to the server; the D5 tests below read it (the window-problem tests never reach it).
  './staffOrderSaveApi': {
    callStaffOrderSave: (action: string, payload: unknown) => {
      sentToServer.push({ action, payload });
      if (nextSaveError) return Promise.reject(nextSaveError);
      return Promise.resolve({ success: true, saved: true, hasTrackedChanges: false, hasCustomerVisibleChanges: false, preserveCurrentStatus: true, oldStatus: 'draft' });
    },
    StaffOrderSaveError: FakeStaffOrderSaveError,
  },
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
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

async function main() {
  // ---------------------------------------------------------------- the shared helper
  ok('complete time: HH:mm and HH:mm:ss', isCompleteTime('09:05') && isCompleteTime('23:59:00') && isCompleteTime('00:00'));
  ok('incomplete or malformed values are not times', !isCompleteTime('') && !isCompleteTime(null) && !isCompleteTime('9:05') && !isCompleteTime('24:00') && !isCompleteTime('10:60') && !isCompleteTime('7pm'));
  eq('normalize drops seconds', normalizeTime('07:15:30'), '07:15');
  eq('normalize of garbage is blank', normalizeTime('nope'), '');
  ok('same-date: end after start is fine', isEndAfterStart('10:00', '14:00', true));
  ok('same-date: end before start is refused', !isEndAfterStart('14:00', '10:00', true));
  ok('same-date: end equal to start is refused', !isEndAfterStart('14:00', '14:00', true));
  ok('same-date: a next-day-pickup style 20:00-23:59 end after a daytime start is valid', isEndAfterStart('10:00', '23:59', true) && isEndAfterStart('18:00', '20:00', true));
  ok('multi-day: any times are valid (overnight / multi-day stay valid)', isEndAfterStart('14:00', '10:00', false) && isEndAfterStart('23:00', '01:00', false));
  ok('BLANK is "not yet chosen", never an end-before-start error', isEndAfterStart('', '', true) && isEndAfterStart('10:00', '', true) && isEndAfterStart('', '09:00', true) && isEndAfterStart(null, undefined, true));
  ok('HH:mm:ss and HH:mm compare on the minute', !isEndAfterStart('14:00:30', '14:00', true) && isEndAfterStart('14:00', '14:01:00', true));
  ok('same-date detection: equal dates, empty end date, longer rental', isSameDateRental({ event_date: '2030-06-01', event_end_date: '2030-06-01' }) && isSameDateRental({ event_date: '2030-06-01', event_end_date: '' }) && !isSameDateRental({ event_date: '2030-06-01', event_end_date: '2030-06-02' }) && !isSameDateRental({ event_date: '', event_end_date: '' }));
  eq('problem: blank start asks for a start time when times are required', eventWindowProblem({ event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '', end_window: '' }, { requireTimes: true }), CHOOSE_START_TIME_MESSAGE);
  eq('problem: a half-chosen window (end missing) asks for the end time', eventWindowProblem({ event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '' }, { requireTimes: true }), CHOOSE_END_TIME_MESSAGE);
  eq('problem: blank times are not an error when times are not required', eventWindowProblem({ event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '', end_window: '' }, { requireTimes: false }), null);
  eq('problem: a reversed same-date window', eventWindowProblem({ event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '15:00', end_window: '09:00' }, { requireTimes: true }), END_BEFORE_START_MESSAGE);
  eq('problem: the same times over two days are fine', eventWindowProblem({ event_date: '2030-06-01', event_end_date: '2030-06-02', start_window: '15:00', end_window: '09:00' }, { requireTimes: true }), null);

  // ---------------------------------------------------------------- Quote validation (customer)
  const cart: any[] = [{ item_type: 'inflatable', unit_name: 'ZZ TEST Castle', isAvailable: true, qty: 1, unit_price_cents: 10000 }];
  const form = (over: Record<string, unknown> = {}): any => ({
    event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '14:00', until_end_of_day: false,
    address_line1: '1 ZZ TEST St', address_line2: '', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83.1,
    location_type: 'residential', pickup_preference: 'next_day', same_day_responsibility_accepted: false, overnight_responsibility_accepted: true, can_stake: true,
    has_generator: false, generator_qty: 0, has_pets: false, special_details: '', ...over,
  });
  ok('Quote: a normal window passes validation', validateQuote(cart, form()).isValid);
  const reversed = validateQuote(cart, form({ start_window: '14:00', end_window: '10:00' }));
  ok('Quote: same-day end before start is refused with the message on the end-time field', !reversed.isValid && reversed.errorMessage === END_BEFORE_START_MESSAGE && reversed.errorFieldId === 'end-time');
  ok('Quote: end equal to start is refused', !validateQuote(cart, form({ start_window: '14:00', end_window: '14:00' })).isValid);
  ok('Quote: a multi-day rental with an earlier end time of day is valid (overnight / multi-day not broken)', validateQuote(cart, form({ event_end_date: '2030-06-03', start_window: '14:00', end_window: '10:00' })).isValid);
  ok('Quote: a next-day-pickup order ending 20:00-23:59 on the event day is valid', validateQuote(cart, form({ end_window: '23:59' })).isValid && validateQuote(cart, form({ start_window: '12:00', end_window: '20:00' })).isValid);
  const blankStart = validateQuote(cart, form({ start_window: '' }));
  ok('Quote: a blank start time gets the "select a start time" prompt, not the order error', !blankStart.isValid && blankStart.errorFieldId === 'start-time' && blankStart.errorMessage === 'Please select an event start time.');
  const blankEnd = validateQuote(cart, form({ end_window: '' }));
  ok('Quote: a blank end time gets the "select an end time" prompt, not the order error', !blankEnd.isValid && blankEnd.errorFieldId === 'end-time' && blankEnd.errorMessage === 'Please select an event end time.');
  // DEC-06: the customer 19:00 cap is consistent between the picker (caps) and validation
  const sameDay = { pickup_preference: 'same_day', same_day_responsibility_accepted: true };
  ok('DEC-06 Quote: a same-day end at exactly 19:00 is valid', validateQuote(cart, form({ ...sameDay, start_window: '10:00', end_window: '19:00' })).isValid);
  const late = validateQuote(cart, form({ ...sameDay, start_window: '10:00', end_window: '19:01' }));
  ok('DEC-06 Quote: a same-day end after 19:00 is refused by validation too (the picker caps it; this keeps them consistent)', !late.isValid && late.errorFieldId === 'end-time');
  ok('DEC-06 Quote: a commercial end after 19:00 is refused', !validateQuote(cart, form({ location_type: 'commercial', pickup_preference: 'same_day', same_day_responsibility_accepted: true, end_window: '21:00' })).isValid);
  ok('DEC-06 Quote: a residential NEXT-DAY order ending 21:00 is NOT capped (existing next-day orders end 20:00-23:59)', validateQuote(cart, form({ end_window: '21:00' })).isValid);

  // ---------------------------------------------------------------- server: create-booking input (REAL validateBookingInput)
  const bookingBody = (event: Record<string, unknown> = {}): any => ({
    contact: { first_name: 'ZZ', last_name: 'TEST', email: 'zz.test@example.test', phone: '5551234567' },
    event: { event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '14:00', location_type: 'residential', pickup_preference: 'next_day', can_stake: true, distance_miles: 5, address: { line1: '1 ZZ TEST St', city: 'Wayne', state: 'MI', zip: '48184', lat: 42.3, lng: -83.4 }, ...event },
    items: [{ type: 'inflatable', unit_id: 'dddddddd-1111-4000-8000-000000000001', wet_or_dry: 'dry', qty: 1 }],
    consents: { sms: true, card_on_file: true },
  });
  ok('server booking: a normal window is accepted', validateBookingInput(bookingBody()).ok);
  const sReversed: any = validateBookingInput(bookingBody({ start_window: '14:00', end_window: '10:00' }));
  ok('server booking: a same-date window ending before it starts is refused', !sReversed.ok && sReversed.error === 'invalid:event.window_order');
  ok('server booking: end equal to start is refused', !validateBookingInput(bookingBody({ start_window: '14:00', end_window: '14:00' })).ok);
  ok('server booking: a multi-day rental with an earlier end time of day is accepted', validateBookingInput(bookingBody({ event_end_date: '2030-06-02', start_window: '14:00', end_window: '10:00' })).ok);
  ok('server booking: 20:00-23:59 on the event day (next-day pickup) is accepted', validateBookingInput(bookingBody({ start_window: '12:00', end_window: '23:59' })).ok);
  ok('server booking: HH:mm:ss times compare on the minute', !validateBookingInput(bookingBody({ start_window: '14:00:30', end_window: '14:00:10' })).ok);
  ok('server booking: a blank time is still the existing windows error (not the order error)', (validateBookingInput(bookingBody({ start_window: '' })) as any).error === 'invalid:event.windows');
  // D5 (WP-P2-25): CHANGED from "the cap is not enforced on the server": customers must not bypass the 19:00 cutoff with a hand-built request.
  const cutoff = (e: Record<string, unknown>): any => validateBookingInput(bookingBody({ start_window: '10:00', ...e }));
  ok('D5 server booking: a commercial end after 19:00 is refused (customers cannot bypass the Quote cap)', (cutoff({ location_type: 'commercial', pickup_preference: 'same_day', end_window: '21:00' }) as any).error === 'invalid:event.end_window_cutoff');
  ok('D5 server booking: a same-day residential end after 19:00 is refused, even by one minute (compared on the minute: 19:00:30 is still 19:00)', (cutoff({ pickup_preference: 'same_day', end_window: '19:01' }) as any).error === 'invalid:event.end_window_cutoff' && cutoff({ pickup_preference: 'same_day', end_window: '19:00:30' }).ok);
  ok('D5 server booking: exactly 19:00 is still accepted for same-day and commercial', cutoff({ pickup_preference: 'same_day', end_window: '19:00' }).ok && cutoff({ location_type: 'commercial', pickup_preference: 'same_day', end_window: '19:00' }).ok);
  ok('D5 server booking: a residential NEXT-DAY order ending 21:00 or 23:59, stays accepted (overnight bookings not broken)', cutoff({ end_window: '21:00' }).ok && cutoff({ end_window: '23:59' }).ok);

  // ---------------------------------------------------------------- server: staff invoice creation (REAL createStaffInvoiceOrder, refused before any database use)
  const invoiceRaw = (event: Record<string, unknown>): any => ({
    customerId: null, items: [{ kind: 'inflatable', unit_id: 'dddddddd-1111-4000-8000-000000000001', wet_or_dry: 'dry', qty: 1 }],
    eventDetails: { event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '14:00', until_end_of_day: false, location_type: 'residential', surface: 'grass', generator_qty: 0, pickup_preference: 'next_day', same_day_responsibility_accepted: false, overnight_responsibility_accepted: false, address_line1: '1 ZZ TEST St', address_line2: '', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83.1, ...event },
    discounts: [], customFees: [], waivers: {}, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', requireCardOnFile: true,
  });
  const noDb: any = { canOverridePricing: true, db: { from: () => { throw new Error('the database must not be reached'); } } };
  const bodyOf = (r: any) => JSON.parse(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? r.json ?? {}));
  async function invoiceRefused(event: Record<string, unknown>) {
    const r: any = await createStaffInvoiceOrder(noDb, invoiceRaw(event));
    const b = bodyOf(r);
    return { status: r.status, detail: b.detail };
  }
  const inv1 = await invoiceRefused({ start_window: '14:00', end_window: '10:00' });
  ok('server invoice: a same-date window ending before it starts is a 400 edited.window_order, before any database use', inv1.status === 400 && inv1.detail === 'edited.window_order');
  const inv2 = await invoiceRefused({ start_window: '14:00', end_window: '14:00' });
  ok('server invoice: end equal to start is refused', inv2.status === 400 && inv2.detail === 'edited.window_order');
  const inv3 = await invoiceRefused({ start_window: '', end_window: '' });
  ok('server invoice: a blank window keeps the existing edited.window refusal (the client now asks first)', inv3.status === 400 && inv3.detail === 'edited.window');
  // D5 server invoice path by role (REAL createStaffInvoiceOrder; the refusal happens before any database use, and an allowed request reaches the database stub).
  const lateSameDay = { pickup_preference: 'same_day', start_window: '10:00', end_window: '21:00' };
  const crewDeps: any = { canOverridePricing: false, db: noDb.db };
  const asRole = async (deps: any, event: Record<string, unknown>, flag?: unknown) => {
    try {
      const r: any = await createStaffInvoiceOrder(deps, { ...invoiceRaw(event), ...(flag === undefined ? {} : { endWindowExceptionConfirmed: flag }) });
      return { reachedDatabase: false, status: r.status, code: bodyOf(r).code };
    } catch (e) {
      return { reachedDatabase: String((e as Error).message).includes('database must not be reached'), status: 0, code: '' };
    }
  };
  const adminNoFlag = await asRole(noDb, lateSameDay);
  ok('D5 server invoice: Admin without the confirmation flag is refused (400 END_WINDOW_CONFIRMATION_REQUIRED) before any database use', adminNoFlag.status === 400 && adminNoFlag.code === 'END_WINDOW_CONFIRMATION_REQUIRED');
  ok('D5 server invoice: Admin with flag=false is refused like no flag', (await asRole(noDb, lateSameDay, false)).code === 'END_WINDOW_CONFIRMATION_REQUIRED');
  const adminStringFlag = await asRole(noDb, lateSameDay, 'true');
  ok('D5 server invoice: a non-boolean flag is an invalid request, not a confirmation', adminStringFlag.status === 400 && adminStringFlag.code === 'INVALID_REQUEST');
  ok('D5 server invoice: Admin with the explicit flag passes the end-time gate (it goes on to the database)', (await asRole(noDb, lateSameDay, true)).reachedDatabase === true);
  ok('D5 server invoice: Admin with the flag on a commercial rental passes too', (await asRole(noDb, { ...lateSameDay, location_type: 'commercial' }, true)).reachedDatabase === true);
  const crewNoFlag = await asRole(crewDeps, lateSameDay);
  const crewFlag = await asRole(crewDeps, lateSameDay, true);
  ok('D5 server invoice: Crew is refused (403 END_WINDOW_NOT_PERMITTED) without the flag', crewNoFlag.status === 403 && crewNoFlag.code === 'END_WINDOW_NOT_PERMITTED');
  ok('D5 server invoice: Crew gains NOTHING by sending the flag (still 403, never reaches the database)', crewFlag.status === 403 && crewFlag.code === 'END_WINDOW_NOT_PERMITTED' && !crewFlag.reachedDatabase);
  ok('D5 server invoice: Crew is refused for a commercial rental after 19:00 as well', (await asRole(crewDeps, { ...lateSameDay, location_type: 'commercial' }, true)).status === 403);
  ok('D5 server invoice: an absent role flag means not allowed (403)', (await asRole({ db: noDb.db }, lateSameDay, true)).status === 403);
  ok('D5 server invoice: exactly 19:00 and a next-day residential 21:00 need no exception for any role', (await asRole(crewDeps, { pickup_preference: 'same_day', end_window: '19:00' })).reachedDatabase === true && (await asRole(crewDeps, { end_window: '21:00' })).reachedDatabase === true);

  // ---------------------------------------------------------------- Edit Order save gate (client)
  const stored = { id: 'o', status: 'draft', event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00:00', end_window: '14:00:00' };
  const edit = (over: Record<string, unknown>) => ({ event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '14:00', ...over });
  eq('Edit Order: an unchanged valid window passes (seconds in the stored value are ignored)', editOrderWindowProblem(stored, edit({})), null);
  eq('Edit Order: changing the end before the start is blocked with the message', editOrderWindowProblem(stored, edit({ end_window: '09:00' })), END_BEFORE_START_MESSAGE);
  eq('Edit Order: a blank time asks for a choice', editOrderWindowProblem(stored, edit({ start_window: '' })), CHOOSE_START_TIME_MESSAGE);
  eq('Edit Order: an overnight / multi-day change is accepted', editOrderWindowProblem(stored, edit({ event_end_date: '2030-06-02', end_window: '09:00' })), null);
  const legacy = { ...stored, start_window: '15:00', end_window: '09:00' };
  eq('Edit Order: an order that ALREADY stores a reversed window is not blocked when this save does not touch the window', editOrderWindowProblem(legacy, edit({ start_window: '15:00', end_window: '09:00' })), null);
  eq('Edit Order: ...but changing it to another reversed window is blocked', editOrderWindowProblem(legacy, edit({ start_window: '15:00', end_window: '08:00' })), END_BEFORE_START_MESSAGE);
  eq('Edit Order: ...and fixing it is accepted', editOrderWindowProblem(legacy, edit({ start_window: '09:00', end_window: '15:00' })), null);

  // ---------------------------------------------------------------- duplicate order (WP-P2-12a): no invented 9:00 / 17:00
  eq('duplicate: a source order without times gives blank times, not 09:00 / 17:00', duplicateOrderTimes({}), { start_window: '', end_window: '' });
  eq('duplicate: null source times give blank', duplicateOrderTimes({ start_window: null, end_window: null }), { start_window: '', end_window: '' });
  eq('duplicate: the source order\'s own saved times are carried (B-22 undecided: behaviour unchanged), without seconds', duplicateOrderTimes({ start_window: '11:30:00', end_window: '18:45' }), { start_window: '11:30', end_window: '18:45' });
  {
    // D2 (WP-P2-12a, B-22 decided): the carried times are editable, validated against the dates chosen on the Quote, and the source is never changed.
    const source = Object.freeze({ id: 'src', start_window: '11:00:00', end_window: '16:30:00', event_date: '2029-01-01', event_end_date: '2029-01-01' });
    const carried = duplicateOrderTimes(source);
    eq('D2 duplicate: the saved source times are carried without seconds, never defaulted', carried, { start_window: '11:00', end_window: '16:30' });
    ok('D2 duplicate: the frozen source order was not modified', source.start_window === '11:00:00' && source.end_window === '16:30:00');
    ok('D2 duplicate: carried times pass Quote validation for newly chosen dates', validateQuote(cart, form({ ...carried, event_date: '2030-07-01', event_end_date: '2030-07-01' })).isValid);
    ok('D2 duplicate: carried times stay editable (a changed time validates on its own)', validateQuote(cart, form({ ...carried, end_window: '17:45', event_date: '2030-07-01', event_end_date: '2030-07-01' })).isValid);
    const multiDaySource = duplicateOrderTimes({ start_window: '14:00', end_window: '10:00' });
    const bad = validateQuote(cart, form({ ...multiDaySource, event_date: '2030-07-01', event_end_date: '2030-07-01' }));
    ok('D2 duplicate: an overnight/multi-day source (end before start) onto a single chosen date is refused with the order message', !bad.isValid && bad.errorMessage === END_BEFORE_START_MESSAGE && bad.errorFieldId === 'end-time');
    ok('D2 duplicate: the same carried times are valid when the new dates are multi-day', validateQuote(cart, form({ ...multiDaySource, event_date: '2030-07-01', event_end_date: '2030-07-03' })).isValid);
    const adminException = duplicateOrderTimes({ start_window: '10:00', end_window: '21:00' });
    ok('D2 duplicate: a source with an Admin after-7-PM exception is NOT a customer bypass (same-day Quote still refuses 21:00)', !validateQuote(cart, form({ ...adminException, pickup_preference: 'same_day', same_day_responsibility_accepted: true })).isValid && validateQuote(cart, form(adminException)).isValid);
    eq('D2 duplicate: malformed source times stay blank (no 9 AM / 5 PM invented)', duplicateOrderTimes({ start_window: '9am', end_window: '25:00' }), { start_window: '', end_window: '' });
    const quoteFormSrc = read('src/hooks/booking/useQuoteForm.ts');
    ok('source-level: a NEW booking form starts with blank start and end times', /start_window: ''/.test(quoteFormSrc) && /end_window: ''/.test(quoteFormSrc));
    ok('source-level: the new-invoice hook starts blank and the duplicate flow only writes a Quote prefill (never the source order)', /start_window: '',/.test(read('src/hooks/invoices/useInvoiceEventDetails.ts')) && !/\.from\('orders'\)\s*\.(update|delete|insert)/.test(read('src/hooks/orders/useOrderDuplication.ts')));
  }
  const dupHook = read('src/hooks/orders/useOrderDuplication.ts');
  ok('source-level: the duplicate hook no longer contains the 09:00 / 17:00 fallbacks', !/'09:00'|'17:00'/.test(dupHook) && dupHook.includes('duplicateOrderTimes(orderData)'));

  // ---------------------------------------------------------------- invoice flows start blank, builders ask before saving (source-level for the builders)
  const invoiceHook = read('src/hooks/invoices/useInvoiceEventDetails.ts');
  ok('source-level: the invoice hook has no 09:00 / 17:00 defaults', !/'09:00'|'17:00'/.test(invoiceHook) && /start_window: '',\s*\n\s*end_window: ''/.test(invoiceHook));
  for (const f of ['src/components/admin/invoices/InvoiceBuilder.tsx', 'src/components/crew/CrewInvoiceBuilder.tsx']) {
    const src = read(f);
    ok(`source-level: ${f} checks the time window before saving and shows the message`, /eventWindowProblem\(eventDetails, \{ requireTimes: true \}\)/.test(src) && /showToast\(windowProblem, 'error'\)/.test(src));
  }
  // ---------------------------------------------------------------- D5 Edit Order (Admin / Master): warn BEFORE saving; cancelling saves nothing
  {
    const stored2 = { id: 'o', status: 'draft', event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00:00', end_window: '14:00:00', location_type: 'residential', pickup_preference: 'same_day' };
    const edited2 = (over: Record<string, unknown> = {}) => ({ location_type: 'residential', pickup_preference: 'same_day', event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '14:00', surface: 'grass', generator_qty: 0, ...over });
    ok('D5 rule: a new after-19:00 end on a same-day rental needs the confirmation; 19:00 and earlier do not', editNeedsEndWindowExceptionConfirmation(stored2, edited2({ end_window: '21:00' })) && !editNeedsEndWindowExceptionConfirmation(stored2, edited2({ end_window: '19:00' })) && !editNeedsEndWindowExceptionConfirmation(stored2, edited2()));
    ok('D5 rule: a residential next-day rental (overnight style) never needs it', !editNeedsEndWindowExceptionConfirmation({ ...stored2, pickup_preference: 'next_day' }, edited2({ pickup_preference: 'next_day', end_window: '23:59' })));
    ok('D5 rule: commercial needs it; an unrelated edit of an order that already stores the later time does not', editNeedsEndWindowExceptionConfirmation(stored2, edited2({ location_type: 'commercial', end_window: '20:00' })) && !editNeedsEndWindowExceptionConfirmation({ ...stored2, end_window: '21:00:00' }, edited2({ end_window: '21:00' })));
    ok('D5 rule: switching the rental type under a stored later time asks again', editNeedsEndWindowExceptionConfirmation({ ...stored2, end_window: '21:00:00', pickup_preference: 'next_day' }, edited2({ end_window: '21:00' })));
    let lastThrown: unknown = null;
    const run = async (edited: Record<string, unknown>, answer: boolean | null) => {
      sentToServer.length = 0;
      const asked: string[] = [];
      let completed = 0;
      let threw: string | null = null;
      lastThrown = null;
      try {
        await saveOrderChanges({ order: stored2, editedOrder: edited, stagedItems: [], discounts: [], customFees: [], calculatedPricing: {}, loadedPricingState: { columns: {}, children: {} }, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', adminOverrideApproval: false, availabilityIssues: [], sendNotificationsFn: async () => {}, onComplete: () => { completed++; },
          confirmEndWindowException: async (m: string) => { asked.push(m); return answer === true; } });
      } catch (e) { threw = (e as Error).message; lastThrown = e; }
      return { asked, completed, threw, thrown: lastThrown, sent: [...sentToServer] };
    };
    const kept = await run(edited2({ end_window: '21:00' }), true);
    ok('D5 Edit Order: the warning names the time and the 19:00 window and is shown before the request', kept.asked.length === 1 && /21:00/.test(kept.asked[0]) && /19:00/.test(kept.asked[0]));
    ok('D5 Edit Order: confirming sends endWindowExceptionConfirmed:true with the save', kept.sent.length === 1 && kept.sent[0].action === 'save_changes' && kept.sent[0].payload.endWindowExceptionConfirmed === true && kept.completed === 1 && kept.threw === null);
    toasts.length = 0;
    const declined = await run(edited2({ end_window: '21:00' }), false);
    ok('D5 Edit Order: CANCELLING the warning saves nothing (no request sent, editor not completed)', declined.asked.length === 1 && declined.sent.length === 0 && declined.completed === 0 && /nothing was saved/.test(declined.threw ?? ''));
    ok('D5 Edit Order: declining throws the typed SaveCancelledError (a neutral cancel, not a generic failure) and shows no toast at all', declined.thrown instanceof SaveCancelledError && toasts.length === 0 && !/Failed to save/i.test(JSON.stringify(toasts)));
    // The modal's catch (real source, source-level): the cancel is checked BEFORE the generic failure branch and only shows a neutral info.
    const modalSrc = read('src/components/admin/orders/OrderDetailModal.tsx');
    ok('source-level: OrderDetailModal treats SaveCancelledError as a neutral info (not the "Failed to save changes" error toast) and keeps the editor open', /error instanceof SaveCancelledError\) \{[^}]*showToast\('No changes were saved\.', 'info'\);\s*\} else if \(error instanceof Error && error\.message !== 'Availability conflict'\)/.test(modalSrc));
    // Other errors still reach the failure path (not cancelled): a server refusal toasts "Failed to save changes", a stock refusal shows the server message.
    toasts.length = 0; nextSaveError = new FakeStaffOrderSaveError('Something broke', 'SAVE_FAILED');
    const failed1 = await run(edited2(), null);
    ok('D5 Edit Order: a server failure is NOT a cancel and still shows the "Failed to save changes" toast', !(failed1.thrown instanceof SaveCancelledError) && failed1.completed === 0 && toasts.some((t) => t.type === 'error' && /Failed to save changes: Something broke/.test(t.message)));
    for (const code of ['AVAILABILITY_CONFLICT', 'AVAILABILITY_UNVERIFIABLE']) {
      toasts.length = 0; nextSaveError = new FakeStaffOrderSaveError('ZZ TEST Castle is not available on those dates.', code);
      const blocked = await run(edited2(), null);
      ok(`Force Approve block (${code}): the server's equipment message is shown as an error, nothing completes, and it is not a cancel`, blocked.completed === 0 && !(blocked.thrown instanceof SaveCancelledError) && toasts.length === 1 && toasts[0].type === 'error' && toasts[0].message === 'ZZ TEST Castle is not available on those dates.' && blocked.threw === 'Availability conflict');
    }
    nextSaveError = null; toasts.length = 0;
    const normal = await run(edited2({ end_window: '18:00' }), null);
    ok('D5 Edit Order: a normal time saves with no warning and no flag', normal.asked.length === 0 && normal.sent.length === 1 && !('endWindowExceptionConfirmed' in normal.sent[0].payload) && normal.completed === 1);
    const storedLate = { ...stored2, end_window: '21:00:00' };
    sentToServer.length = 0;
    const askedUnrelated: string[] = [];
    await saveOrderChanges({ order: storedLate, editedOrder: edited2({ end_window: '21:00', surface: 'cement' }), stagedItems: [], discounts: [], customFees: [], calculatedPricing: {}, loadedPricingState: { columns: {}, children: {} }, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', adminOverrideApproval: false, availabilityIssues: [], sendNotificationsFn: async () => {}, onComplete: () => {}, confirmEndWindowException: async (m: string) => { askedUnrelated.push(m); return true; } });
    ok('D5 Edit Order: an unrelated save of an order that already stores the later time is not asked about', askedUnrelated.length === 0 && sentToServer.length === 1 && !('endWindowExceptionConfirmed' in sentToServer[0].payload));
    ok('D5 request builder: the flag is only ever sent when true', !('endWindowExceptionConfirmed' in buildSaveRequest({ order: stored2, editedOrder: edited2(), stagedItems: [], discounts: [], customFees: [], calculatedPricing: {}, loadedPricingState: { columns: {}, children: {} }, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', adminOverrideApproval: false, availabilityIssues: [], sendNotificationsFn: async () => {}, onComplete: () => {}, endWindowExceptionConfirmed: false })));
  }

  ok('source-level: the Edit Order save path checks the window before the request', /editOrderWindowProblem\(order, params\.editedOrder\)/.test(read('src/lib/orders/staffOrderSaveRequest.ts')));

  // ---------------------------------------------------------------- server and client rule agree (the servers cannot import src/)
  const serverFile = read('supabase/functions/_shared/orders/staff-order-save.ts') + read('supabase/functions/_shared/booking/bookingInput.ts');
  ok('source-level: both server files compare HH:mm with a strict "end <= start refuses"', (serverFile.match(/end_window\.slice\(0, 5\) <= (e\.)?start_window\.slice\(0, 5\)|endWindow\.slice\(0, 5\) <= startWindow\.slice\(0, 5\)/g) ?? []).length === 2);
  ok('source-level: both servers use the same 19:00 cutoff constant as the client (SAME_DAY_LATEST_END_TIME)', endWindowRules.SAME_DAY_LATEST_END_TIME === '19:00' && /SAME_DAY_LATEST_END_TIME = "19:00"/.test(serverFile) && /endWindow\.slice\(0, 5\) > "19:00"/.test(serverFile));
  const grid = ['00:00', '09:59', '10:00', '12:30', '23:58', '23:59'];
  let agree = true;
  for (const s of grid) {
    for (const e of grid) {
      const client = isEndAfterStart(s, e, true);
      const server = validateBookingInput(bookingBody({ start_window: s, end_window: e })).ok;
      if (client !== server) agree = false;
    }
  }
  ok('the client helper and the server booking check agree on every start/end pair of a 6-point grid (same-date)', agree);

  // ---------------------------------------------------------------- Continue control: no price AND no message is not possible (F-40)
  const ready = { hasTotals: true, pricingConfigError: null, isCalculating: false, depositError: null, submitting: false };
  eq('Continue: the existing ready state is unchanged', quoteContinueState(ready), { disabled: false, label: 'Continue to Checkout →', reason: null });
  eq('Continue: no totals and no chosen address says to choose the address', quoteContinueState({ ...ready, hasTotals: false, needsAddress: true }).reason, CHOOSE_ADDRESS_REASON);
  eq('Continue: no totals and a chosen address still says calculating', quoteContinueState({ ...ready, hasTotals: false, needsAddress: false }).reason, 'Calculating your total...');
  ok('Continue: with totals, a missing address does not hide the price or block (needsAddress only explains a missing price)', !quoteContinueState({ ...ready, needsAddress: true }).disabled);
  ok('Continue: the address hint is disabled-state, never enabled', quoteContinueState({ ...ready, hasTotals: false, needsAddress: true }).disabled);
  ok('Continue: submitting and pricing errors still win over the address hint', quoteContinueState({ ...ready, hasTotals: false, needsAddress: true, submitting: true }).label === 'Checking availability...' && quoteContinueState({ ...ready, hasTotals: false, needsAddress: true, pricingConfigError: 'x' }).reason?.includes('Pricing is unavailable') === true);

  // ---------------------------------------------------------------- saved-address geocode: the Maps-load race (F-40), reproduced
  const preciseResult = { geometry: { location_type: 'ROOFTOP', location: { lat: () => 42.33, lng: () => -83.05 } } };
  const noWait = () => Promise.resolve();
  {
    // The old code called `new google.maps.Geocoder()` at once. A loader that is not ready on the first attempt makes that throw.
    let ready1 = false;
    let created = 0;
    const old = async () => {
      try {
        if (!ready1) throw new Error('google is not defined');
        return { status: 'found' };
      } catch {
        return { status: 'gave up (old behaviour: error logged, never retried)' };
      }
    };
    eq('REPRODUCED: the former one-shot lookup gives up when Maps is not ready yet', (await old()).status, 'gave up (old behaviour: error logged, never retried)');
    let loads = 0;
    const out = await geocodeSavedAddress('1 ZZ TEST St, Detroit, MI 48201', {
      ensureMapsLoaded: async () => { loads++; if (loads < 2) throw new Error('Google Maps loading timeout'); ready1 = true; },
      createGeocoder: () => { created++; return { geocode: async () => ({ results: [preciseResult] }) }; },
      wait: noWait,
    });
    eq('FIXED: the lookup waits for Maps, retries, and finds the coordinates', out, { status: 'found', lat: 42.33, lng: -83.05 });
    eq('...it loaded Maps twice and used one geocoder', [loads, created], [2, 1]);
  }
  eq('geocode: a city-centre (APPROXIMATE) answer is "imprecise", never used for pricing', await geocodeSavedAddress('x', { ensureMapsLoaded: async () => {}, createGeocoder: () => ({ geocode: async () => ({ results: [{ geometry: { location_type: 'APPROXIMATE', location: { lat: () => 42, lng: () => -83 } } }] }) }), wait: noWait }), { status: 'imprecise' });
  eq('geocode: a partial match is "imprecise"', await geocodeSavedAddress('x', { ensureMapsLoaded: async () => {}, createGeocoder: () => ({ geocode: async () => ({ results: [{ partial_match: true, ...preciseResult }] }) }), wait: noWait }), { status: 'imprecise' });
  eq('geocode: no results is "imprecise"', await geocodeSavedAddress('x', { ensureMapsLoaded: async () => {}, createGeocoder: () => ({ geocode: async () => ({ results: [] }) }), wait: noWait }), { status: 'imprecise' });
  eq('geocode: a 0,0 location is not accepted', await geocodeSavedAddress('x', { ensureMapsLoaded: async () => {}, createGeocoder: () => ({ geocode: async () => ({ results: [{ geometry: { location_type: 'ROOFTOP', location: { lat: () => 0, lng: () => 0 } } }] }) }), wait: noWait }), { status: 'imprecise' });
  {
    let tries = 0;
    const waits: number[] = [];
    const out = await geocodeSavedAddress('x', { ensureMapsLoaded: async () => { tries++; throw new Error('script failed'); }, createGeocoder: () => ({ geocode: async () => ({ results: [] }) }), wait: async (ms) => { waits.push(ms); }, attempts: 3, retryDelayMs: 10 });
    eq('geocode: a Maps that never loads is "failed" after the retries (the Quote then shows the choose-address message)', [out.status, tries, waits.length], ['failed', 3, 2]);
  }

  // The hook wiring (source-level)
  const quoteForm = read('src/hooks/booking/useQuoteForm.ts');
  ok('source-level: the prefill geocode waits for the Maps loader and uses the retrying helper', quoteForm.includes('geocodeSavedAddress(address') && quoteForm.includes('ensureMapsLoaded: ensureGoogleMapsLoaded') && !/const geocoder = new google\.maps\.Geocoder\(\);\s*\n\s*const address/.test(quoteForm));
  ok('source-level: an imprecise saved street is cleared and the address box emptied', /outcome\.status === 'imprecise'/.test(quoteForm) && quoteForm.includes('...QUOTE_ADDRESS_EDIT_RESET') && quoteForm.includes("setAddressInput('')"));
  ok('source-level: the Quote passes needsAddress to the summary', /needsAddress=\{!hasSelectedAddress\(formData\)\}/.test(read('src/pages/Quote.tsx')));

  // ---------------------------------------------------------------- profile address: stale coordinates from another address are cleared
  const session = { addressLine1: '2 ZZ TEST Ave', addressLine2: '', city: 'Detroit', state: 'MI', zip: '48202' };
  const stale = buildProfileAddressUpdate({ address_line1: '1 Old St', lat: 42.1, lng: -83.9 }, session) as any;
  ok('profile address: coordinates left over from a DIFFERENT street are reset so the saved street is looked up again', stale.address_line1 === '2 ZZ TEST Ave' && stale.lat === 0 && stale.lng === 0 && stale.picked_locality === null);
  const same = buildProfileAddressUpdate({ address_line1: '2 ZZ TEST Ave', lat: 42.4, lng: -83.2 }, session) as any;
  ok('profile address: the same street that already has coordinates keeps them (no needless lookup)', same.lat === undefined && same.lng === undefined && same.zip === '48202');
  const blank = buildProfileAddressUpdate({ address_line1: '', lat: 0, lng: 0 }, session) as any;
  ok('profile address: a blank form gets the street with zero coordinates', blank.address_line1 === '2 ZZ TEST Ave' && blank.lat === 0 && blank.lng === 0);
  eq('profile address: city and state fall back as before', [buildProfileAddressUpdate({ address_line1: '', lat: 0, lng: 0 }, { ...session, city: '', state: '' }).city, buildProfileAddressUpdate({ address_line1: '', lat: 0, lng: 0 }, { ...session, city: '', state: '' }).state], ['Detroit', 'MI']);

  // ---------------------------------------------------------------- W1 request: a swallowed travel-city verifier error keeps its reason (source-level; diagnostics only)
  const saveSrc = read('supabase/functions/_shared/orders/staff-order-save.ts');
  ok('source-level: staff-order-save sets VERIFIER_THREW_REASON on a swallowed verifier error', /catch \{[^}]*verification = \{ status: "unverified", reason: VERIFIER_THREW_REASON \};/.test(saveSrc) && saveSrc.includes('VERIFIER_THREW_REASON, type AddressVerifier'));
  ok('source-level: the warning includes the reason and the full trusted travelCity (with reason) goes to recordTravelCityReview in both save paths', saveSrc.includes('reason=${trusted.reason}') && (saveSrc.match(/travelCity: travelCityCheck\.trusted/g) ?? []).length === 2);
  const { resolveTrustedTravelCity, VERIFIER_THREW_REASON } = await import('../../../../supabase/functions/_shared/booking/addressVerification');
  const threw: any = resolveTrustedTravelCity({ status: 'unverified', reason: VERIFIER_THREW_REASON }, 'Plymouth', ['Plymouth']);
  ok('the reason reaches the review note input and the typed free city stays unverified (no price change: distance fee, never free)', threw.reason === 'verifier threw' && threw.review === 'typed_free_city_not_verified' && threw.city === '');

  console.log(`\nWP-P1-11 / P2-12a / P2-25 / P1-12 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
void main();
