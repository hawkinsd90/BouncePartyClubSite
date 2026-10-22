// WP-10 (B9): saving a route order.
//
// The route screen used to fire one update per task, ignore every result (so "Route saved" appeared even when a write failed) and
// skip tasks that had no task_status row yet (their position was silently lost). The plan below separates the three kinds of write
// and the runner checks every result, so the screen can keep its unsaved work and say what failed.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RouteSaveTask {
  orderId: string;
  type: string;
  // yyyy-MM-dd of the task (the caller formats it in local time)
  dateKey: string;
  taskStatusId: string | null;
}

export interface RouteSavePlan {
  // Existing rows: set sort_order to the position.
  positioned: Array<{ id: string; sort_order: number }>;
  // Existing rows taken out of the route: sort_order becomes null.
  excluded: Array<{ id: string }>;
  // Tasks without a row yet: create it (pending) or, if a row appeared meanwhile, only set sort_order.
  missing: Array<{ order_id: string; task_type: string; task_date: string; sort_order: number }>;
}

export function planRouteSave(ordered: RouteSaveTask[], excluded: RouteSaveTask[]): RouteSavePlan {
  const plan: RouteSavePlan = { positioned: [], excluded: [], missing: [] };
  ordered.forEach((task, index) => {
    if (task.taskStatusId) plan.positioned.push({ id: task.taskStatusId, sort_order: index });
    else plan.missing.push({ order_id: task.orderId, task_type: task.type, task_date: task.dateKey, sort_order: index });
  });
  for (const task of excluded) if (task.taskStatusId) plan.excluded.push({ id: task.taskStatusId });
  return plan;
}

export interface RouteSaveClient {
  from(table: string): any;
}

export interface RouteSaveResult {
  ok: boolean;
  // One message per failed write (never includes row data).
  errors: string[];
}

// Runs the plan and reports every failure. Nothing is thrown for a failed write: the caller decides what to show.
export async function runRouteSave(client: RouteSaveClient, plan: RouteSavePlan): Promise<RouteSaveResult> {
  const errors: string[] = [];
  const writes: Array<PromiseLike<{ error: any }>> = [];

  for (const row of plan.positioned) {
    writes.push(client.from('task_status').update({ sort_order: row.sort_order }).eq('id', row.id));
  }
  for (const row of plan.excluded) {
    writes.push(client.from('task_status').update({ sort_order: null }).eq('id', row.id));
  }
  if (plan.missing.length > 0) {
    // One request for every task without a row. Only sort_order is written on conflict, so a row created a moment ago by someone
    // else keeps its status, times and photos. New rows take the table defaults (status 'pending').
    writes.push(client.from('task_status').upsert(plan.missing, { onConflict: 'order_id,task_type,task_date' }));
  }

  const settled = await Promise.allSettled(writes);
  for (const s of settled) {
    if (s.status === 'rejected') errors.push(String((s.reason as any)?.message ?? s.reason ?? 'request failed'));
    else if (s.value?.error) errors.push(String(s.value.error.message ?? 'write failed'));
  }
  return { ok: errors.length === 0, errors };
}
