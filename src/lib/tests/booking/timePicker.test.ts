// Time picker. The pure logic below (timeSelect.ts: parsing "HH:mm" / "HH:mm:ss", every minute round-trips, nothing chosen by default, a
// half-chosen time emits nothing, the value format stays "HH:mm") is unchanged. WP-P2-12b (F-34) replaced the three-select component by the
// native time control; the component assertions near the end are SOURCE-LEVEL and describe that control.
import { readFileSync } from 'node:fs';
import {
  EMPTY_TIME_DRAFT,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  PERIOD_OPTIONS,
  applyHourChange,
  applyMinuteChange,
  applyPeriodChange,
  formatDisplayTime,
  formatMinute,
  parseTime24,
  toTime24,
} from '../../core/timeSelect';

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

// Options
eq('60 minute options', MINUTE_OPTIONS.length, 60);
eq('minutes start at 00', formatMinute(MINUTE_OPTIONS[0]), '00');
eq('minutes end at 59', MINUTE_OPTIONS[59], 59);
eq('minutes are consecutive', MINUTE_OPTIONS.every((m, i) => m === i), true);
eq('twelve hours 1..12', HOUR_OPTIONS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
eq('periods', PERIOD_OPTIONS, ['AM', 'PM']);
eq('two-digit minutes', [formatMinute(0), formatMinute(5), formatMinute(59)], ['00', '05', '59']);

// Parsing
eq('parse 09:05', parseTime24('09:05'), { hour: 9, minute: 5, period: 'AM' });
eq('parse 00:00 is 12:00 AM', parseTime24('00:00'), { hour: 12, minute: 0, period: 'AM' });
eq('parse 12:00 is 12:00 PM', parseTime24('12:00'), { hour: 12, minute: 0, period: 'PM' });
eq('parse 13:30', parseTime24('13:30'), { hour: 1, minute: 30, period: 'PM' });
eq('parse off-grid 23:59', parseTime24('23:59'), { hour: 11, minute: 59, period: 'PM' });
eq('parse HH:mm:ss ignores seconds', parseTime24('07:15:30'), { hour: 7, minute: 15, period: 'AM' });
eq('parse empty', parseTime24(''), null);
eq('parse null', parseTime24(null), null);
eq('parse garbage', parseTime24('7pm'), null);
eq('parse 24:00 invalid', parseTime24('24:00'), null);
eq('parse minute 60 invalid', parseTime24('10:60'), null);

// Round trip: every minute of the day survives parse -> toTime24
let roundTripOk = true;
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m++) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const parsed = parseTime24(value);
    if (!parsed || toTime24(parsed) !== value) roundTripOk = false;
  }
}
eq('all 1440 minutes round-trip', roundTripOk, true);

// Selection behavior
eq('empty draft emits nothing', toTime24(EMPTY_TIME_DRAFT), null);
let d = applyHourChange(EMPTY_TIME_DRAFT, 7);
eq('choosing an hour sets minutes to 00', d, { hour: 7, minute: 0, period: null });
eq('hour without AM/PM emits nothing', toTime24(d), null);
d = applyPeriodChange(d, 'PM');
eq('hour + AM/PM emits 19:00', toTime24(d), '19:00');
d = applyMinuteChange(d, 45);
eq('minute 45 emits 19:45', toTime24(d), '19:45');
d = applyHourChange(d, 8);
eq('a new hour resets minutes to 00', toTime24(d), '20:00');
d = applyPeriodChange(applyMinuteChange(d, 7), 'AM');
eq('AM switch keeps hour and minute', toTime24(d), '08:07');
eq('12 AM is 00:xx', toTime24({ hour: 12, minute: 30, period: 'AM' }), '00:30');
eq('12 PM is 12:xx', toTime24({ hour: 12, minute: 30, period: 'PM' }), '12:30');
d = applyHourChange({ hour: 9, minute: 15, period: 'PM' }, null);
eq('clearing the hour clears minutes and emits nothing', [d.hour, d.minute, toTime24(d)], [null, null, null]);
eq('period chosen first, hour later', toTime24(applyHourChange(applyPeriodChange(EMPTY_TIME_DRAFT, 'AM'), 6)), '06:00');

eq('display 7:05 PM', formatDisplayTime('19:05'), '7:05 PM');
eq('display empty', formatDisplayTime(''), '');

// Component wiring (SOURCE-LEVEL assertions: they read the component text, they do not render it). WP-P2-12b (F-34): the picker is the
// native time control again, replacing the Hr / Min / AM-PM selects that these assertions used to describe.
const picker = read('src/components/ui/TimePickerInput.tsx');
eq('source-level: picker renders the native time input', /<input[\s\S]*?type="time"/.test(picker), true);
eq('source-level: picker no longer renders hour / minute / AM-PM selects', /<select|aria-label="Hour"|aria-label="Minute"|aria-label="AM or PM"/.test(picker), false);
eq('source-level: the input carries the label id (htmlFor works) and an optional accessible name', /<input\s+id=\{id\}/.test(picker) && picker.includes('aria-label={ariaLabel}'), true);
eq('source-level: control is at least 48px tall', picker.includes('min-h-[48px]'), true);
eq('source-level: 16px text avoids iOS zoom', picker.includes('text-base') && picker.includes("fontSize: '16px'"), true);
eq('source-level: required and disabled are passed to the native input (native "required" works)', picker.includes('required={required}') && picker.includes('disabled={disabled}'), true);
eq('source-level: min / max / step are NOT put on the input (they would constrain minute entry on some phones)', /<input[\s\S]*?\/>/.exec(picker)?.[0].match(/\b(min|max|step)=/) === null, true);
eq('source-level: the picker puts no default time anywhere (empty stays empty)', !/'\d\d:\d\d'/.test(picker.replace(/'HH:mm'/g, '')) && !/value=\{[^}]*\|\|\s*'\d/.test(picker), true);
eq('source-level: the value shown is the caller\'s value without seconds (saved times are never replaced)', picker.includes('normalizeTime(value)') && picker.includes('onChange(e.target.value)'), true);
const editor = read('src/components/order-detail/EventDetailsEditor.tsx');
eq('source-level: admin editor uses the shared picker', (editor.match(/<TimePickerInput/g) || []).length === 2 && !/type="time"/.test(editor), true);
for (const f of ['src/components/quote/EventDetailsSection.tsx', 'src/pages/Contact.tsx']) {
  eq(`source-level: ${f} still uses the shared picker`, read(f).includes('<TimePickerInput'), true);
}
eq('source-level: all four consumers (Quote, Edit Order and both invoice builders through the editor, Contact) still use the one shared picker file', ['src/components/quote/EventDetailsSection.tsx', 'src/components/order-detail/EventDetailsEditor.tsx', 'src/pages/Contact.tsx'].every((f) => read(f).includes("from '../ui/TimePickerInput'") || read(f).includes("from '../components/ui/TimePickerInput'")) && ['src/components/admin/invoices/InvoiceBuilder.tsx', 'src/components/crew/CrewInvoiceBuilder.tsx'].every((f) => read(f).includes('EventDetailsEditor')), true);

console.log(`\nWP-05 time picker tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
