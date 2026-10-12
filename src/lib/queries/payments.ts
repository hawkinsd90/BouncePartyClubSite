import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getPaymentsByOrderId(orderId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('payments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false }),
    { context: 'getPaymentsByOrderId', ...options }
  );
}

export async function getPaymentById(paymentId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .maybeSingle(),
    { context: 'getPaymentById', ...options }
  );
}

// (Payments are written only by the server payment functions; the browser has no write access to this table.)

export async function getAllPayments(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('payments')
        .select(`
          *,
          orders (
            order_number,
            customers (
              first_name,
              last_name,
              email
            )
          )
        `)
        .order('created_at', { ascending: false }),
    { context: 'getAllPayments', ...options }
  );
}
