import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { loadOrderSummary, formatOrderSummary } from '../../lib/orders/orderSummaryLoader';
import type { Database } from '../../lib/database.types';

type Tables = Database['public']['Tables'];

export interface DamageRecord {
  orderId: string;
  amount_cents: number;
  status: string;
  created_at: string;
}

export function usePendingOrderData(orderId: string) {
  const [smsConversations, setSmsConversations] = useState<any[]>([]);
  const [payments, setPayments] = useState<Tables['payments']['Row'][]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [contact, setContact] = useState<Pick<Tables['contacts']['Row'], 'business_name'> | null>(null);
  const [orderSummary, setOrderSummary] = useState<ReturnType<typeof formatOrderSummary> | null>(null);
  const [customFees, setCustomFees] = useState<Array<Pick<Tables['order_custom_fees']['Row'], 'id' | 'amount_cents' | 'name'>>>([]);
  const [discounts, setDiscounts] = useState<Array<Pick<Tables['order_discounts']['Row'], 'id' | 'amount_cents' | 'percentage' | 'name'>>>([]);
  const [customerDamageRecords, setCustomerDamageRecords] = useState<DamageRecord[]>([]);
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

  async function loadCustomFees() {
    const { data } = await supabase
      .from('order_custom_fees')
      .select('id, amount_cents, name')
      .eq('order_id', orderId);
    if (data) setCustomFees(data);
  }

  async function loadDiscounts() {
    const { data } = await supabase
      .from('order_discounts')
      .select('id, amount_cents, percentage, name')
      .eq('order_id', orderId);
    if (data) setDiscounts(data);
  }

  async function loadCustomerDamageHistory(customerId: string) {
    const { data: customerOrders } = await supabase
      .from('orders')
      .select('id')
      .eq('customer_id', customerId)
      .neq('id', orderId);

    if (!customerOrders?.length) return;

    const orderIds = customerOrders.map((o) => o.id);
    const { data: damagePayments } = await supabase
      .from('payments')
      .select('order_id, amount_cents, status, created_at')
      .in('order_id', orderIds)
      .eq('type', 'damage');

    if (damagePayments?.length) {
      setCustomerDamageRecords(
        damagePayments.map((p) => ({
          orderId: p.order_id,
          amount_cents: p.amount_cents,
          status: p.status,
          created_at: p.created_at,
        }))
      );
    }
  }

  async function loadRefunds() {
    const { data } = await supabase
      .from('order_refunds')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    if (data) setRefunds(data);
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
    refunds,
    contact,
    orderSummary,
    customFees,
    discounts,
    customerDamageRecords,
    loadSmsConversations,
    loadContact,
    loadPayments,
    loadRefunds,
    loadSummary,
    loadCustomFees,
    loadDiscounts,
    loadCustomerDamageHistory,
  };
}
