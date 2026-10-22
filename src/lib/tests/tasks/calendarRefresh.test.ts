// WP-10 / WP-11 (B9): background refreshes must not close modals, a route save must tell the truth, mileage dates are local, and a
// refund result stays on screen.
// PASS - LOCAL AUTOMATED (pure rules + a scripted database client + source assertions). The two-device test, the phone keyboard
// behaviour and the Stripe TEST refund (A-15) are REQUIRES HOSTED DEV VERIFICATION: A-10..A-15, K-06.
import { readFileSync } from 'node:fs';
import { shouldRaiseLoading } from '../../core/loadingPolicy';
import { endMileageProblem, localDateKey } from '../../core/localDate';
import { planRouteSave, runRouteSave } from '../../tasks/routeSave';

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
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

async function main() {
  // --- when the spinner may show --------------------------------------------------------------------------------------------
  eq('first load shows the spinner', shouldRaiseLoading({ hasData: false }), true);
  eq('a month change (foreground) shows the spinner', shouldRaiseLoading({ background: false, hasData: true }), true);
  eq('a realtime / manual / role refresh (background) never does', [shouldRaiseLoading({ background: true, hasData: true }), shouldRaiseLoading({ background: true, hasData: false })], [false, false]);
  eq('a screen that keeps its data does not after the first load', shouldRaiseLoading({ keepDataWhileRefetching: true, hasData: true }), false);
  eq('... but still does for its first load', shouldRaiseLoading({ keepDataWhileRefetching: true, hasData: false }), true);
  eq('a screen that did not opt in is unchanged (spinner on every refetch)', shouldRaiseLoading({ hasData: true }), true);

  // --- route save plan -------------------------------------------------------------------------------------------------
  const T = (id: string, status: string | null, type = 'drop-off') => ({ orderId: `o-${id}`, type, dateKey: '2026-11-10', taskStatusId: status });
  const plan = planRouteSave([T('a', 'ts-a'), T('b', null), T('c', 'ts-c'), T('d', null, 'pick-up')], [T('x', 'ts-x'), T('y', null)]);
  eq('rows that exist are positioned by their place in the list', plan.positioned, [{ id: 'ts-a', sort_order: 0 }, { id: 'ts-c', sort_order: 2 }]);
  eq('tasks without a row are planned for creation with their position (they used to be skipped)', plan.missing, [
    { order_id: 'o-b', task_type: 'drop-off', task_date: '2026-11-10', sort_order: 1 },
    { order_id: 'o-d', task_type: 'pick-up', task_date: '2026-11-10', sort_order: 3 },
  ]);
  eq('only excluded tasks that have a row are cleared', plan.excluded, [{ id: 'ts-x' }]);
  eq('an empty route plans nothing', planRouteSave([], []), { positioned: [], excluded: [], missing: [] });

  // scripted client: records writes and answers with the next scripted error (if any)
  const makeClient = (failing: Set<string> = new Set()) => {
    const calls: Array<{ op: string; payload: unknown; filter?: [string, unknown]; opts?: unknown }> = [];
    const client = {
      from(table: string) {
        if (table !== 'task_status') throw new Error(`unexpected table ${table}`);
        return {
          update: (payload: unknown) => ({
            eq: (col: string, val: unknown) => {
              calls.push({ op: 'update', payload, filter: [col, val] });
              return Promise.resolve({ error: failing.has(String(val)) ? { message: `update ${val} failed` } : null });
            },
          }),
          upsert: (payload: unknown, opts: unknown) => {
            calls.push({ op: 'upsert', payload, opts });
            return Promise.resolve({ error: failing.has('upsert') ? { message: 'upsert failed' } : null });
          },
        };
      },
    };
    return { client, calls };
  };
  {
    const { client, calls } = makeClient();
    const r = await runRouteSave(client, plan);
    ok('a clean save reports ok', r.ok && r.errors.length === 0);
    eq('one update per existing row, in order, plus one clear for the excluded row', calls.filter((c) => c.op === 'update').map((c) => [c.filter?.[1], (c.payload as any).sort_order]), [['ts-a', 0], ['ts-c', 2], ['ts-x', null]]);
    const ups = calls.filter((c) => c.op === 'upsert');
    ok('ONE bulk upsert covers every task without a row, on the unique key', ups.length === 1 && (ups[0].payload as any[]).length === 2 && (ups[0].opts as any).onConflict === 'order_id,task_type,task_date');
    ok('the upsert writes only the key and sort_order (it cannot overwrite status, times or photos)', (ups[0].payload as any[]).every((row) => Object.keys(row).sort().join() === 'order_id,sort_order,task_date,task_type'));
  }
  {
    const { client } = makeClient(new Set(['ts-c']));
    const r = await runRouteSave(client, plan);
    ok('a failed update is reported (the screen used to say "saved")', !r.ok && r.errors.length === 1 && /ts-c/.test(r.errors[0]));
  }
  {
    const { client } = makeClient(new Set(['upsert', 'ts-a']));
    const r = await runRouteSave(client, plan);
    ok('every failure is collected, none is swallowed', !r.ok && r.errors.length === 2);
  }
  {
    const throwing = { from: () => ({ update: () => ({ eq: () => Promise.reject(new Error('network down')) }), upsert: () => Promise.reject(new Error('network down')) }) };
    const r = await runRouteSave(throwing as any, plan);
    ok('a rejected request is a reported failure, not a thrown error', !r.ok && r.errors.every((e) => /network down/.test(e)));
  }
  {
    const { client, calls } = makeClient();
    const r = await runRouteSave(client, planRouteSave([T('a', 'ts-a')], []));
    ok('no upsert is sent when every task already has a row', r.ok && calls.every((c) => c.op === 'update'));
  }

  // --- local dates and mileage rules ---------------------------------------------------------------------------------------
  eq('local date key for a late-evening local time stays on that day', localDateKey(new Date(2026, 10, 10, 23, 30)), '2026-11-10');
  eq('local date key at local midnight', localDateKey(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  eq('single digits are padded', localDateKey(new Date(2026, 2, 5, 9, 0)), '2026-03-05');
  eq('end reading below the start reading is refused with the start shown', endMileageProblem(100, 150), "The ending reading can't be lower than the starting reading (150).");
  eq('end equal to start is allowed (no driving)', endMileageProblem(150, 150), null);
  eq('end above start is allowed', endMileageProblem(151.4, 150), null);
  eq('no start reading: only the basic check applies', endMileageProblem(10, null), null);
  eq('zero / NaN is not a reading', [endMileageProblem(0, 5), endMileageProblem(NaN, 5)], ['Please enter a valid mileage reading', 'Please enter a valid mileage reading']);

  // --- the calendar hook ----------------------------------------------------------------------------------------------
  const hook = read('src/hooks/admin/useCalendarTasks.ts');
  ok('realtime refresh is a background load', /debounceTimerRef\.current = setTimeout\(\(\) => \{[\s\S]{0,300}loadTasksForMonth\(currentMonthRef\.current, \{ background: true \}\)/.test(hook));
  ok('manual reload is a background load', /reload: \(\) => loadTasksForMonth\(currentMonthRef\.current, \{ background: true \}\)/.test(hook));
  ok('the queued follow-up refresh is a background load', /pendingRefreshRef\.current = false;\n\s+loadTasksForMonth\(currentMonthRef\.current, \{ background: true \}\)/.test(hook));
  ok('a month change is the only foreground load', (hook.match(/loadTasksForMonth\(currentMonth\);/g) ?? []).length === 1);
  ok('the spinner goes through the shared policy', /shouldRaiseLoading\(\{ background, hasData: false \}\)/.test(hook) && !/\n\s+setLoading\(true\);/.test(hook));
  const cal = read('src/components/AdminCalendar.tsx');
  ok('mileage saves bump a version that the open task screen watches', /setMileageVersion\(\(v\) => v \+ 1\)/.test(cal) && /mileageVersion=\{mileageVersion\}/.test(cal));
  ok('the calendar month range for mileage dots uses local dates', /localDateKey\(startOfMonth\(currentMonth\)\)/.test(cal) && !/toISOString\(\)\.split/.test(cal));
  const taskModal = read('src/components/admin/tasks/TaskDetailModal.tsx');
  ok('the task screen reads the mileage log again when the version changes', /\[task\.date, mileageVersion\]/.test(taskModal) && /localDateKey\(task\.date\)/.test(taskModal));

  // --- refund result (WP-11) -------------------------------------------------------------------------------------------
  ok('a refund answer refreshes the task WITHOUT closing it (onRefresh, not onUpdate)', /onRefundChanged=\{refresh\}/.test(taskModal) && !/onRefundChanged=\{onUpdate\}/.test(taskModal));
  ok('"refresh" is the non-closing callback and onUpdate is the closing one', /const refresh = onRefresh \|\| onUpdate/.test(taskModal) && /onRefresh=\{handleTaskRefresh\}/.test(cal) && /onUpdate=\{\(\) => \{\n\s+setSelectedTask\(null\);/.test(cal));

  // --- route modal -----------------------------------------------------------------------------------------------------
  const route = read('src/components/calendar/RouteManagementModal.tsx');
  ok('save goes through the plan and checks every result', /planRouteSave\(/.test(route) && /runRouteSave\(supabase, plan\)/.test(route) && !/await Promise\.all\(\[\.\.\.updates/.test(route));
  ok('a failed save keeps the modal open and never shows the success toast', /if \(!result\.ok\) \{[\s\S]{0,400}return;\n\s+\}\n\s+showToast\('Route saved successfully'/.test(route));
  ok('X and Cancel share one unsaved-changes guard', /function requestClose\(\)/.test(route) && (route.match(/onClick=\{requestClose\}/g) ?? []).length === 2);
  ok('Save / Cancel are a sticky footer', /sticky bottom-0 -mx-4 sm:-mx-6/.test(route));
  ok('the route arrows are 44px touch targets', (route.match(/min-w-\[44px\] min-h-\[44px\] flex items-center justify-center hover:bg-slate-200/g) ?? []).length === 2);

  // --- mileage modal ---------------------------------------------------------------------------------------------------
  const mm = read('src/components/calendar/MileageModal.tsx');
  ok('mileage modal: scrollable overlay', /fixed inset-0 bg-black bg-opacity-50 z-\[70\] overflow-y-auto/.test(mm) && /min-h-full flex items-center justify-center/.test(mm));
  ok('mileage modal: no autofocus (the keyboard no longer covers Save)', !/autoFocus/.test(mm));
  ok('mileage modal: the form is reset on every open and for each type', /setMileage\(''\);\n\s+setNotes\(''\);\n\s+setExistingLog\(null\);/.test(mm) && /\[isOpen, date, type\]/.test(mm));
  ok('mileage modal: local dates and the End >= Start rule', !/toISOString\(\)\.split/.test(mm) && (mm.match(/localDateKey\(date\)/g) ?? []).length === 3 && /endMileageProblem\(mileageNum, existingLog\?\.start_mileage\)/.test(mm));
  ok('no calendar or mileage file keys a day by the UTC date any more', ['src/components/calendar/DayViewModal.tsx', 'src/hooks/admin/useRouteOptimization.ts', 'src/components/admin/tasks/TaskDetailModal.tsx'].every((f) => !/toISOString\(\)\.split\('T'\)/.test(read(f))));

  // --- orders / admin lists ---------------------------------------------------------------------------------------------
  const fetchHook = read('src/hooks/core/useDataFetch.ts');
  ok('useDataFetch: opt-in keepDataWhileRefetching uses the shared policy for both load paths', (fetchHook.match(/if \(raiseLoading\(\)\) setLoading\(true\)/g) ?? []).length === 2 && /hasDataRef\.current = true/.test(fetchHook));
  ok('other screens keep the old behaviour (the option defaults to false)', /keepDataWhileRefetching = false/.test(fetchHook));
  const orders = read('src/components/admin/orders/OrdersManager.tsx');
  ok('Orders: keeps its data while refetching, so an open order modal survives', /keepDataWhileRefetching: true/.test(orders));
  ok('Orders: toggling Show Archived recomputes the list', /\[categorizedOrders, activeTab, showArchived, searchTerm, sortColumn, sortDirection, contactsMap\]/.test(orders));
  ok('Admin: keeps its data while refetching', /keepDataWhileRefetching: true/.test(read('src/pages/Admin.tsx')));

  console.log(`calendarRefresh: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} calendar refresh test(s) failed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
