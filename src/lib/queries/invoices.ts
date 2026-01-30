import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

const INVOICE_WITH_RELATIONS = `
  *,
  customers (*),
  orders (
    *,
    customers (*),
    addresses (*),
    order_items (
      *,
      units (*)
    ),
    payments (*),
    order_discounts (*),
    order_custom_fees (*)
  )
`;

export async function getInvoiceById(invoiceId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .select(INVOICE_WITH_RELATIONS)
        .eq('id', invoiceId)
        .maybeSingle(),
    { context: 'getInvoiceById', ...options }
  );
}

export async function getInvoiceByToken(token: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .select(INVOICE_WITH_RELATIONS)
        .eq('token', token)
        .maybeSingle(),
    { context: 'getInvoiceByToken', ...options }
  );
}

export async function getAllInvoices(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .select(`
          *,
          customers (
            first_name,
            last_name,
            email,
            business_name
          )
        `)
        .order('created_at', { ascending: false }),
    { context: 'getAllInvoices', ...options }
  );
}

export async function createInvoice(invoiceData: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single(),
    { context: 'createInvoice', ...options }
  );
}

export async function updateInvoice(invoiceId: string, updates: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId)
        .select()
        .single(),
    { context: 'updateInvoice', ...options }
  );
}

export async function deleteInvoice(invoiceId: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId),
    { context: 'deleteInvoice', ...options }
  );
}
