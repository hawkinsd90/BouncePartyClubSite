// useDeliveryTimingAnalytics: the get_delivery_timing_analytics call after the database types were reconciled with the migrated schema.
// Both date arguments default to NULL in the SQL function (p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL), and the generated type
// makes them optional strings (never null). An open bound is therefore left out of the call instead of being sent as null; the function treats
// both the same way (NULL = no bound). PASS - LOCAL AUTOMATED (the real hook through the hook runner, a recording Supabase stand-in).
import { runHook, loadModuleWithMocks } from '../../lib/tests/support/hookHarness';

type RpcCall = { fn: string; args: Record<string, unknown> | undefined };
const calls: RpcCall[] = [];
const supabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve({ data: { avg_travel_minutes: 12, task_counts: { total_dropoff: 1 } }, error: null });
  },
};
const { useDeliveryTimingAnalytics } = loadModuleWithMocks('src/hooks/admin/useAdminAnalytics.ts', { '../../lib/supabase': { supabase } });

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}

async function main() {
  calls.length = 0;
  const open = runHook(useDeliveryTimingAnalytics, 'all_time');
  const r1 = (await open.settle()) as { data: { avg_travel_minutes: number | null } | null; loading: boolean };
  ok('all_time: one call to get_delivery_timing_analytics', calls.length === 1 && calls[0].fn === 'get_delivery_timing_analytics');
  ok('all_time: both bounds are left out (the SQL defaults are NULL), none is sent as null', JSON.stringify(calls[0].args) === '{}');
  ok('all_time: the result reaches the hook', r1.data?.avg_travel_minutes === 12 && r1.loading === false);

  calls.length = 0;
  const week = runHook(useDeliveryTimingAnalytics, '7d');
  await week.settle();
  const a = calls[0].args as { p_start_date?: string; p_end_date?: string };
  ok('7d: both bounds are date-only strings', /^\d{4}-\d{2}-\d{2}$/.test(a.p_start_date ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(a.p_end_date ?? ''));
  ok('7d: the start is before the end', (a.p_start_date ?? '') < (a.p_end_date ?? ''));
  ok('7d: no null argument is ever sent', Object.values(a).every((v) => v !== null));

  console.log(`useAdminAnalytics: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} useAdminAnalytics test(s) failed`);
}
main();
