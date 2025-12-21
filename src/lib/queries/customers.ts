import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getCustomerById(customerId: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle(),
    { context: 'getCustomerById', ...options }
  );
}

export async function getCustomerByEmail(email: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .select('*')
        .eq('email', email)
        .maybeSingle(),
    { context: 'getCustomerByEmail', ...options }
  );
}

export async function getCustomerByPhone(phone: string, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .maybeSingle(),
    { context: 'getCustomerByPhone', ...options }
  );
}

export async function createCustomer(customerData: any, options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .insert(customerData)
        .select()
        .single(),
    { context: 'createCustomer', ...options }
  );
}

export async function updateCustomer(
  customerId: string,
  updates: any,
  options?: QueryOptions
) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .update(updates)
        .eq('id', customerId)
        .select()
        .single(),
    { context: 'updateCustomer', ...options }
  );
}

export async function getOrCreateCustomer(customerData: any, options?: QueryOptions) {
  return executeQuery(
    async () => {
      const { data: existing } = await supabase
        .from('customers')
        .select('*')
        .eq('email', customerData.email)
        .maybeSingle();

      if (existing) {
        return { data: existing, error: null };
      }

      return supabase
        .from('customers')
        .insert(customerData)
        .select()
        .single();
    },
    { context: 'getOrCreateCustomer', ...options }
  );
}

export async function getAllCustomers(options?: QueryOptions) {
  return executeQuery(
    () =>
      supabase
        .from('customers')
        .select('*')
        .order('last_name', { ascending: true }),
    { context: 'getAllCustomers', ...options }
  );
}
