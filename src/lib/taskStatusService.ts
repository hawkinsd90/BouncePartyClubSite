// Shared task_status get-or-create persistence, extracted verbatim from
// TaskDetailModal.ensureTaskStatus and RouteManagementModal.handleOptimize.
//
// Owns only the database algorithm: select by (order_id, task_type, task_date), insert a minimal
// pending row when absent, and recover from a concurrent insert (unique violation 23505) by
// re-selecting the winner. Callers keep their own short-circuit guards, date formatting, column
// projection and Task/UI mapping. No React state, no toasts, no logging policy.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TaskStatusClient {
  from(table: string): any;
}

export interface GetOrCreateTaskStatusParams {
  orderId: string;
  taskType: string;
  // Already-resolved date key (callers use format(task.date, 'yyyy-MM-dd')).
  taskDate: string;
  // Column projection requested by the caller; used for every select in the algorithm.
  select: string;
  // Called with the raw error just before a non-23505 insert error is thrown.
  onInsertError?: (insertError: any) => void;
}

export interface TaskStatusRowResult {
  row: any;
  // True only when this call inserted the row. A row found by the initial select or recovered
  // after a 23505 race is reported as not created.
  created: boolean;
}

export async function getOrCreateTaskStatusRow(
  client: TaskStatusClient,
  { orderId, taskType, taskDate, select, onInsertError }: GetOrCreateTaskStatusParams,
): Promise<TaskStatusRowResult> {
  // Step 1: check for an existing row without overwriting it
  const { data: existing, error: selectError } = await client
    .from('task_status')
    .select(select)
    .eq('order_id', orderId)
    .eq('task_type', taskType)
    .eq('task_date', taskDate)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return { row: existing, created: false };

  // Step 2: insert a minimal pending row — never overwrite status,
  // timestamps, images, notes, or sort_order on an existing row
  const { data: inserted, error: insertError } = await client
    .from('task_status')
    .insert({
      order_id: orderId,
      task_type: taskType,
      task_date: taskDate,
      status: 'pending',
    })
    .select(select)
    .single();

  if (insertError) {
    // Step 3: unique violation 23505 means a concurrent request won the race
    if (insertError.code === '23505') {
      const { data: raceWinner, error: raceSelectError } = await client
        .from('task_status')
        .select(select)
        .eq('order_id', orderId)
        .eq('task_type', taskType)
        .eq('task_date', taskDate)
        .single();
      if (raceSelectError) throw raceSelectError;
      return { row: raceWinner, created: false };
    }
    if (onInsertError) onInsertError(insertError);
    throw insertError;
  }

  return { row: inserted, created: true };
}
