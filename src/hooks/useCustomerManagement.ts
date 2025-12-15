import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { showToast } from '../lib/notifications';

interface NewCustomer {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

const initialCustomerState: NewCustomer = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  business_name: '',
};

export function useCustomerManagement() {
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomer>(initialCustomerState);
  const [saving, setSaving] = useState(false);

  async function createNewCustomer(onSuccess?: (customer: any) => void) {
    if (!newCustomer.first_name || !newCustomer.last_name || !newCustomer.email || !newCustomer.phone) {
      showToast('Please fill in all required customer fields', 'error');
      return null;
    }

    setSaving(true);
    try {
      const { data: existingCustomers, error: checkError } = await supabase
        .from('customers')
        .select('first_name, last_name, email, phone')
        .or(`and(email.eq.${newCustomer.email},phone.eq.${newCustomer.phone})`);

      if (checkError) throw checkError;

      if (existingCustomers && existingCustomers.length > 0) {
        const existing = existingCustomers[0];
        if (
          existing.first_name.toLowerCase() === newCustomer.first_name.toLowerCase() &&
          existing.last_name.toLowerCase() === newCustomer.last_name.toLowerCase()
        ) {
          showToast(
            `A customer with this email (${newCustomer.email}) and phone (${newCustomer.phone}) already exists with the same name.`,
            'error'
          );
          return null;
        }
        showToast(
          `A customer with both this email (${newCustomer.email}) AND phone number (${newCustomer.phone}) already exists. They can share one or the other, but not both unless the name is identical.`,
          'error'
        );
        return null;
      }

      const { data, error } = await supabase
        .from('customers')
        .insert([newCustomer])
        .select()
        .single();

      if (error) throw error;

      setSelectedCustomer(data.id);
      setShowNewCustomerForm(false);
      setNewCustomer(initialCustomerState);

      if (onSuccess) {
        onSuccess(data);
      }

      return data;
    } catch (error) {
      console.error('Error creating customer:', error);
      showToast('Failed to create customer', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function clearCustomer() {
    setSelectedCustomer('');
    setCustomerSearchQuery('');
  }

  function toggleNewCustomerForm() {
    setShowNewCustomerForm(!showNewCustomerForm);
  }

  function resetCustomerForm() {
    setNewCustomer(initialCustomerState);
    setShowNewCustomerForm(false);
  }

  return {
    selectedCustomer,
    setSelectedCustomer,
    customerSearchQuery,
    setCustomerSearchQuery,
    showCustomerDropdown,
    setShowCustomerDropdown,
    showNewCustomerForm,
    setShowNewCustomerForm,
    newCustomer,
    setNewCustomer,
    saving,
    createNewCustomer,
    clearCustomer,
    toggleNewCustomerForm,
    resetCustomerForm,
  };
}
