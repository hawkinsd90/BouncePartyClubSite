import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  business_name?: string;
  delivery_address: string;
  event_date: string;
  event_end_date?: string;
  event_start_time?: string;
  event_end_time?: string;
  event_type?: string;
  expected_guest_count?: number;
  setup_location?: string;
  pickup_preference?: string;
  special_details?: string;
  items: any[];
  notes?: string;
  subtotal: number;
  travel_fee: number;
  tax: number;
  tip_amount?: number;
  total: number;
  deposit_amount?: number;
  deposit_override?: number;
  custom_discounts?: any[];
  custom_fees?: any[];
  admin_message?: string;
  stripe_payment_intent_id?: string;
  stripe_payment_status?: string;
  cancellation_reason?: string;
  created_at: string;
  user_id?: string;
}

interface Payment {
  id: string;
  order_id: string;
  amount: number;
  payment_type: string;
  payment_method?: string;
  stripe_payment_intent_id?: string;
  status: string;
  created_at: string;
}

interface PricingRule {
  id: string;
  base_delivery_fee: number;
  per_mile_rate: number;
  free_delivery_radius: number;
  generator_daily_rate: number;
  generator_overnight_rate: number;
  tax_rate: number;
}

export function useOrderDetails(orderId: string | null) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) {
      loadData();
    }
  }, [orderId]);

  const loadData = async () => {
    if (!orderId) return;

    try {
      setLoading(true);
      await Promise.all([
        loadOrderDetails(),
        loadPayments(),
        loadPricingRules(),
      ]);
    } catch (err) {
      console.error('Error loading order data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOrderDetails = async () => {
    if (!orderId) return;

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) throw error;
    setOrder(data as any);
  };

  const loadPayments = async () => {
    if (!orderId) return;

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    setPayments((data || []) as any[]);
  };

  const loadPricingRules = async () => {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('*');

    if (error) throw error;

    if (data) {
      const settings: any = {};
      data.forEach((s: any) => {
        settings[s.key] = s.value;
      });
      setPricingRules(settings);
    }
  };

  return {
    order,
    payments,
    pricingRules,
    loading,
    reload: loadData,
    setOrder,
    setPayments,
  };
}
