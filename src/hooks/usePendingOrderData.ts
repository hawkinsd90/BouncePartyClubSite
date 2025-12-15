import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { loadOrderSummary, formatOrderSummary } from '../lib/orderSummary';

export function usePendingOrderData(orderId: string) {
  const [smsConversations, setSmsConversations] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [contact, setContact] = useState<any>(null);
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const loadingSummaryRef = useRef(false);

  async function loadSmsConversations() {
    const { data } = await supabase
      .from('sms_conversations')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (data) setSmsConversations(data);
  }

  async function loadContact(customerEmail: string) {
    const { data } = await supabase
      .from('contacts')
      .select('business_name')
      .eq('email', customerEmail)
      .maybeSingle();
    if (data) setContact(data);
  }

  async function loadPayments() {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    if (data) setPayments(data);
  }

  async function loadSummary() {
    if (loadingSummaryRef.current) {
      return;
    }

    loadingSummaryRef.current = true;
    try {
      const data = await loadOrderSummary(orderId);
      if (data) {
        setOrderSummary(formatOrderSummary(data));
      }
    } catch (error) {
      console.error('[usePendingOrderData] Error loading order summary:', error);
    } finally {
      loadingSummaryRef.current = false;
    }
  }

  return {
    smsConversations,
    payments,
    contact,
    orderSummary,
    loadSmsConversations,
    loadContact,
    loadPayments,
    loadSummary,
  };
}
