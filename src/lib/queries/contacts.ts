import { supabase } from '../supabase';
import { executeQuery, QueryOptions } from './base';

export async function getContactByEmail(email: string, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('contacts')
        .select('*')
        .eq('email', email)
        .maybeSingle(),
    { context: 'getContactByEmail', ...options }
  );
}

export async function getAllContacts(options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false }),
    { context: 'getAllContacts', ...options }
  );
}

export async function createContact(contactData: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('contacts')
        .insert(contactData)
        .select()
        .single(),
    { context: 'createContact', ...options }
  );
}

export async function updateContact(email: string, updates: any, options?: QueryOptions) {
  return executeQuery(
    async () =>
      await supabase
        .from('contacts')
        .update(updates)
        .eq('email', email)
        .select()
        .single(),
    { context: 'updateContact', ...options }
  );
}
