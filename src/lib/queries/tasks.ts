import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

const TASK_WITH_RELATIONS = `
  *,
  orders (
    id,
    order_number,
    event_date,
    event_end_date,
    event_start_time,
    event_end_time,
    customers (
      first_name,
      last_name,
      phone,
      email
    ),
    addresses (
      line1,
      city,
      state,
      zip
    )
  ),
  task_status (*)
`;

export async function getAllTasks(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .select(TASK_WITH_RELATIONS)
        .order('scheduled_date', { ascending: true }),
    { context: 'getAllTasks', ...options }
  );
}

export async function getTaskById(taskId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .select(TASK_WITH_RELATIONS)
        .eq('id', taskId)
        .maybeSingle(),
    { context: 'getTaskById', ...options }
  );
}

export async function getTasksByDateRange(
  startDate: string,
  endDate: string,
  options?: QueryOptions
) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .select(TASK_WITH_RELATIONS)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: true }),
    { context: 'getTasksByDateRange', ...options }
  );
}

export async function getTasksByOrderId(orderId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .select(TASK_WITH_RELATIONS)
        .eq('order_id', orderId)
        .order('scheduled_date', { ascending: true }),
    { context: 'getTasksByOrderId', ...options }
  );
}

export async function createTask(taskData: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .insert(taskData)
        .select()
        .single(),
    { context: 'createTask', ...options }
  );
}

export async function updateTask(taskId: string, updates: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .update(updates)
        .eq('id', taskId)
        .select()
        .single(),
    { context: 'updateTask', ...options }
  );
}

export async function deleteTask(taskId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId),
    { context: 'deleteTask', ...options }
  );
}
