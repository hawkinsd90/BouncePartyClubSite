// The browser's side of a staff order save. It sends what the staff member CHANGED and the state it was looking at; the server
// (supabase/functions/staff-order-save) prices the result and writes it. The response carries no price the browser must trust: it
// only says whether the save happened and what follow-up (notifications, lifecycle) applies.

import { getEdgeAuthToken } from './edgeAuth';

export class StaffOrderSaveError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function callStaffOrderSave<T = Record<string, unknown>>(action: 'save_changes' | 'create_invoice', payload: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-order-save`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${await getEdgeAuthToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } finally {
    clearTimeout(timeoutId);
  }
  let data: Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data.success === false) {
    throw new StaffOrderSaveError(String(data.error || 'The changes could not be saved.'), String(data.code || 'SAVE_FAILED'));
  }
  return data as T;
}
