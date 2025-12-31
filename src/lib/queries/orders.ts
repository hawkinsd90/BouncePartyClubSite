import { supabase } from '../supabase';
import { executeQuery, STANDARD_ORDER_SELECT, COMPACT_ORDER_SELECT, QueryOptions } from './base';

export async function getOrderById(orderId: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(STANDARD_ORDER_SELECT)
        .eq('id', orderId)
        .maybeSingle(),
    { context: 'getOrderById', ...options }
  );
}

export async function getOrdersByCustomerId(customerId: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .eq('customer_id', customerId)
        .order('event_date', { ascending: false }),
    { context: 'getOrdersByCustomerId', ...options }
  );
}

export async function getOrdersByEmail(email: string, options?: QueryOptions) {
  return executeQuery(
    async () => {
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!customer) {
        return { data: [], error: null };
      }

      return supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .eq('customer_id', customer.id)
        .order('event_date', { ascending: false });
    },
    { context: 'getOrdersByEmail', ...options }
  );
}

export async function getAllOrders(options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .order('event_date', { ascending: true }),
    { context: 'getAllOrders', ...options }
  );
}

export async function getOrdersByDateRange(
  startDate: string,
  endDate: string,
  options?: QueryOptions
) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .gte('event_date', startDate)
        .lte('event_date', endDate)
        .order('event_date', { ascending: true }),
    { context: 'getOrdersByDateRange', ...options }
  );
}

export async function getOrdersByStatus(status: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .eq('status', status)
        .order('event_date', { ascending: true }),
    { context: 'getOrdersByStatus', ...options }
  );
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  options?: QueryOptions
) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .select()
        .single(),
    { context: 'updateOrderStatus', ...options }
  );
}

export async function getOrderPayments(orderId: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('payments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false }),
    { context: 'getOrderPayments', ...options }
  );
}

export async function getOrderWithRelations(orderId: string, options?: QueryOptions) {
  return getOrderById(orderId, options);
}

export async function checkOrderExists(orderId: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select('id')
        .eq('id', orderId)
        .maybeSingle(),
    { context: 'checkOrderExists', ...options }
  );
}

export async function getOrdersWithPendingPayments(options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .or('deposit_paid_cents.lt.deposit_due_cents,balance_paid_cents.lt.balance_due_cents')
        .order('event_date', { ascending: true }),
    { context: 'getOrdersWithPendingPayments', ...options }
  );
}

export async function getAllOrdersWithContacts(options?: QueryOptions) {
  return executeQuery(
    async () => {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(COMPACT_ORDER_SELECT)
        .order('event_date', { ascending: true });

      if (ordersError) {
        throw ordersError;
      }

      if (!ordersData || ordersData.length === 0) {
        return { data: { orders: [], contactsMap: new Map() }, error: null };
      }

      const uniqueEmails = [...new Set(
        ordersData
          .map((o: any) => o.customers?.email)
          .filter(Boolean)
      )] as string[];

      if (uniqueEmails.length === 0) {
        return { data: { orders: ordersData, contactsMap: new Map() }, error: null };
      }

      const { data: contacts } = await supabase
        .from('contacts')
        .select('email, business_name, total_bookings')
        .in('email', uniqueEmails);

      const contactsMap = new Map();
      contacts?.forEach((c: any) => contactsMap.set(c.email, c));

      return { data: { orders: ordersData, contactsMap }, error: null };
    },
    { context: 'getAllOrdersWithContacts', ...options }
  );
}
