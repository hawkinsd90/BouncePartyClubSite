// Defect: the delete / deactivate-unit warnings looked up future bookings with orders.order_number and orders.customer_name (not columns) and
// with the status spellings "voided" / "canceled" (the real ones are 'void' and 'cancelled'). The query failed on every call, the failure was
// only logged, and an empty list came back: the warning never fired. The database side is executed in coreDatabaseAccess ("unit warning: ...":
// the exact columns and statuses the lookup uses are accepted by the real schema, the old ones are refused with 42703). This file pins the
// request the lookup makes, how a booking is described, and that both screens use the shared lookup.
import { readFileSync } from 'node:fs';
import { describeFutureBooking, fetchFutureBookings, FUTURE_BOOKING_SELECT, NON_BOOKING_ORDER_STATUSES, type FutureBooking } from '../../units/futureBooking';

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

const calls: Array<[string, unknown[]]> = [];
function fakeClient(result: { data: unknown; error: unknown }) {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'eq', 'not', 'or']) {
    chain[m] = (...a: unknown[]) => {
      calls.push([m, a]);
      return m === 'or' ? Promise.resolve(result) : chain;
    };
  }
  return chain as never;
}

const REAL_ORDER_COLUMNS = ['id', 'event_date', 'event_end_date', 'status'];
const REAL_CUSTOMER_COLUMNS = ['first_name', 'last_name'];

async function main() {
  const rows: FutureBooking[] = [
    { order_id: 'o1', orders: { id: 'a1b2c3d4-0000-4000-8000-000000000001', event_date: '2030-06-01', event_end_date: '2030-06-01', status: 'confirmed', customers: { first_name: 'Ann', last_name: 'Lee' } } },
  ];
  const found = await fetchFutureBookings(fakeClient({ data: rows, error: null }), 'unit-1', '2030-01-01');
  eq('the lookup returns the bookings it found', found, rows);
  const sel = calls.find((c) => c[0] === 'select')?.[1][0] as string;
  ok('it selects only real order columns', !/order_number|customer_name/.test(sel) && REAL_ORDER_COLUMNS.every((c) => sel.includes(c)));
  ok('it reads the customer name through the customers relation (first_name, last_name)', REAL_CUSTOMER_COLUMNS.every((c) => sel.includes(c)) && /customers\(/.test(sel));
  eq('it filters on the unit', calls.find((c) => c[0] === 'eq')?.[1], ['unit_id', 'unit-1']);
  eq('it ignores the cancelled and void orders (the real status values)', calls.find((c) => c[0] === 'not')?.[1], ['orders.status', 'in', '(cancelled,void)']);
  eq('the ignored statuses are the real ones', [...NON_BOOKING_ORDER_STATUSES], ['cancelled', 'void']);
  eq('it keeps orders that start or end today or later', calls.find((c) => c[0] === 'or')?.[1], ['event_date.gte.2030-01-01,event_end_date.gte.2030-01-01', { referencedTable: 'orders' }]);
  ok('the exported select text has no nonexistent columns', !/order_number|customer_name/.test(FUTURE_BOOKING_SELECT));

  const err = console.error;
  console.error = () => {};
  const failedLookup = await fetchFutureBookings(fakeClient({ data: null, error: { message: 'boom' } }), 'unit-1', '2030-01-01');
  console.error = err;
  eq('a failed lookup still returns an empty list (and is logged), as before', failedLookup, []);

  eq('a booking reads as short order id, customer name and date', describeFutureBooking(rows[0]), '• Order #A1B2C3D4 - Ann Lee on 2030-06-01');
  eq('a booking without a customer record is not "undefined undefined"', describeFutureBooking({ ...rows[0], orders: { ...rows[0].orders, customers: null } }), '• Order #A1B2C3D4 - Unknown customer on 2030-06-01');
  eq('a customer with only a first name', describeFutureBooking({ ...rows[0], orders: { ...rows[0].orders, customers: { first_name: 'Ann', last_name: null } } }), '• Order #A1B2C3D4 - Ann on 2030-06-01');

  for (const f of ['src/components/admin/catalog/InventorySection.tsx', 'src/pages/UnitForm.tsx']) {
    const t = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    ok(`${f}: uses the shared lookup and description`, /fetchFutureBookings\(supabase, unitId, todayLocalKey\(\)\)/.test(t) && /\.map\(describeFutureBooking\)/.test(t));
    ok(`${f}: no longer names order_number / customer_name`, !/order_number|customer_name/.test(t));
  }

  console.log(`futureBooking: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} future booking test(s) failed`);
}
main();
