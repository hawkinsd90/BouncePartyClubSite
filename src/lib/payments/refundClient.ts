// The browser side of the two server calls the refund screen makes: read the refund overview, and send a refund request. Kept apart
// from the screen logic so that logic never imports the Supabase client (and can be tested without a browser).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../supabase';
import type { RefundOverview, SubmitBody } from './refundAllocationRequest';
import type { RefundApi } from './refundController';

export async function loadRefundOverview(orderId: string): Promise<RefundOverview> {
  const { data, error } = await (supabase as any).rpc('order_refund_overview', { p_order_id: orderId });
  if (error) throw new Error(error.message || 'The refund details could not be loaded.');
  if (!data) throw new Error('You do not have access to this order\'s refund details, or the order was not found.');
  return data as RefundOverview;
}

// Rejects when the request cannot be made or its answer never arrives; otherwise resolves with the status and the parsed body (null
// when the body is not JSON), so the caller can keep the request identity for a retry in every uncertain case.
export async function submitRefundRequest(body: SubmitBody): Promise<{ status: number; data: any }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export const defaultRefundApi: RefundApi = { loadOverview: loadRefundOverview, submit: submitRefundRequest };
