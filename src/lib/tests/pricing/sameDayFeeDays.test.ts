// WP-14 (B2): the days on which the same-day delivery fee applies are a pricing rule. The default (Monday to Friday) reproduces the old
// hard-coded behavior; the Detroit calendar date decides "today", never the computer's or UTC's.
import { readFileSync } from 'node:fs';
import { DEFAULT_SAME_DAY_FEE_DAYS, isSameDayFeeDay, isSameDayWeekdayDelivery } from '../../pricing';

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
const TZ = 'America/Detroit';
const at = (iso: string) => new Date(iso);

// The previous implementation, kept here as the oracle for "default parity".
function oldWeekdayRule(eventDateYMD: string, now: Date): boolean {
  if (!eventDateYMD) return false;
  const todayYMD = now.toLocaleDateString('en-CA', { timeZone: TZ });
  if (eventDateYMD !== todayYMD) return false;
  const [year, month, day] = eventDateYMD.split('-').map(Number);
  const dow = new Date(year, month - 1, day).getDay();
  return dow >= 1 && dow <= 5;
}

eq('default days are Monday to Friday', [...DEFAULT_SAME_DAY_FEE_DAYS], [1, 2, 3, 4, 5]);

// Wednesday 2026-10-21 (15:00 UTC = 11:00 EDT)
const WED = at('2026-10-21T15:00:00Z');
eq('Wednesday today with default days', isSameDayFeeDay('2026-10-21', WED, TZ, undefined), true);
eq('null days use the default', isSameDayFeeDay('2026-10-21', WED, TZ, null), true);
eq('Wednesday not in [0,6]', isSameDayFeeDay('2026-10-21', WED, TZ, [0, 6]), false);
eq('Wednesday in [3]', isSameDayFeeDay('2026-10-21', WED, TZ, [3]), true);
eq('empty list never charges', isSameDayFeeDay('2026-10-21', WED, TZ, []), false);
eq('a different date is never "today"', isSameDayFeeDay('2026-10-22', WED, TZ, [0, 1, 2, 3, 4, 5, 6]), false);
eq('empty date', isSameDayFeeDay('', WED, TZ, [3]), false);
eq('garbage date', isSameDayFeeDay('not-a-date', WED, TZ, [3]), false);

// Saturday and Sunday are chargeable only when selected
const SAT = at('2026-10-24T16:00:00Z');
const SUN = at('2026-10-25T16:00:00Z');
eq('Saturday default is free', isSameDayFeeDay('2026-10-24', SAT, TZ, undefined), false);
eq('Saturday when selected', isSameDayFeeDay('2026-10-24', SAT, TZ, [6]), true);
eq('Sunday default is free', isSameDayFeeDay('2026-10-25', SUN, TZ, undefined), false);
eq('Sunday when selected', isSameDayFeeDay('2026-10-25', SUN, TZ, [0]), true);
eq('weekday dropped from the list', isSameDayFeeDay('2026-10-21', WED, TZ, [1, 2, 4, 5]), false);

// Detroit evening is still "today" even though UTC is already tomorrow (23:30 EDT = 03:30 UTC next day)
const LATE = at('2026-10-22T03:30:00Z');
eq('23:30 Detroit: the Detroit date is still Wednesday', isSameDayFeeDay('2026-10-21', LATE, TZ, [3]), true);
eq('23:30 Detroit: the UTC date (Thursday) is not today', isSameDayFeeDay('2026-10-22', LATE, TZ, [4]), false);
// Early morning Detroit (00:30 EDT = 04:30 UTC) is already the new Detroit day
eq('00:30 Detroit uses the new Detroit date', isSameDayFeeDay('2026-10-22', at('2026-10-22T04:30:00Z'), TZ, [4]), true);

// Daylight saving: fall back (2026-11-01 Sunday) and spring forward (2026-03-08 Sunday)
eq('fall-back day 00:30 EDT is Sunday', isSameDayFeeDay('2026-11-01', at('2026-11-01T04:30:00Z'), TZ, [0]), true);
eq('fall-back day 23:30 EST is still Sunday', isSameDayFeeDay('2026-11-01', at('2026-11-02T04:30:00Z'), TZ, [0]), true);
eq('spring-forward day 03:30 EDT is Sunday', isSameDayFeeDay('2026-03-08', at('2026-03-08T07:30:00Z'), TZ, [0]), true);
eq('spring-forward day is not a weekday by default', isSameDayFeeDay('2026-03-08', at('2026-03-08T07:30:00Z'), TZ, undefined), false);

// Default parity with the previous implementation over a full year of instants, every date
let parity = true;
for (let day = 0; day < 366 && parity; day++) {
  for (const hourUtc of [0, 3, 5, 12, 20, 23]) {
    const now = new Date(Date.UTC(2026, 0, 1 + day, hourUtc, 30));
    const todayYMD = now.toLocaleDateString('en-CA', { timeZone: TZ });
    for (const candidate of [todayYMD, '2026-06-15']) {
      if (isSameDayFeeDay(candidate, now, TZ, undefined) !== oldWeekdayRule(candidate, now)) parity = false;
    }
  }
}
eq('default behavior is identical to the old Monday-Friday rule', parity, true);
eq('exported function keeps working without a days argument', typeof isSameDayWeekdayDelivery('2000-01-01'), 'boolean');

// --- wiring (source) ---------------------------------------------------------------------------------------------------------
const orderCalc = read('src/lib/pricing/orderPricingCalculation.ts');
eq('order pricing passes the rule days into the check', orderCalc.includes('resolved.isSameDayWeekdayDelivery(eventDetails.event_date, pricingRules?.same_day_delivery_fee_days)'), true);
eq('quote pricing passes the rule days', read('src/hooks/booking/useQuotePricing.ts').includes('isSameDayWeekdayDelivery(formData.event_date, pricingRules.same_day_delivery_fee_days)'), true);
eq('invoice pricing passes the rule days', read('src/hooks/invoices/useInvoicePricing.ts').includes('isSameDayWeekdayDelivery(eventDetails.event_date, pricingRules.same_day_delivery_fee_days)'), true);
eq('server booking build passes the rule days', read('supabase/functions/_shared/booking/bookingBuild.ts').includes('isSameDayWeekdayDelivery(event.event_date, rules.same_day_delivery_fee_days)'), true);
eq('server copy of the pricing module has the days rule', read('supabase/functions/_shared/booking/pricing.ts').includes('export function isSameDayFeeDay('), true);
eq('server copy of order pricing passes the days', read('supabase/functions/_shared/booking/orderPricingCalculation.ts').includes('same_day_delivery_fee_days'), true);
const tab = read('src/components/admin/settings/PricingRulesTab.tsx');
eq('admin screen has Sunday-Saturday chips', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].every((d) => tab.includes(`label: '${d}'`)), true);
eq('admin save writes the days column', tab.includes('same_day_delivery_fee_days:'), true);
eq('customer/admin labels no longer say Weekday for the fee', !/Same[- ]Day Weekday Delivery Fee/.test([tab, read('src/components/order-detail/OrderDetailsTab.tsx'), read('src/components/admin/invoices/builder/InvoiceFeeWaivers.tsx'), read('src/lib/orders/staffOrderSaveRequest.ts')].join('\n')), true);

// --- migration text ----------------------------------------------------------------------------------------------------------
const sql = read('supabase/migrations/20261027120000_same_day_delivery_fee_days.sql');
eq('migration adds the column with the Monday-Friday default', /ADD COLUMN IF NOT EXISTS same_day_delivery_fee_days smallint\[\] NOT NULL DEFAULT '\{1,2,3,4,5\}'/.test(sql), true);
eq('migration validates days 0-6 and no NULL members', sql.includes('<@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]') && sql.includes('array_position(same_day_delivery_fee_days, NULL) IS NULL'), true);
eq('migration is additive (no drop of data, no table rewrite of existing columns)', !/DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM/i.test(sql), true);

console.log(`\nWP-14 same-day fee days tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
