import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getOrderById, getOrderPayments } from '../lib/queries/orders';

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
  const isLoadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const currentOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (orderId) {
      loadData();
    }
  }, [orderId]);

  const loadData = async () => {
    if (!orderId) return;
    if (isLoadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isLoadingRef.current = true;
    pendingRefreshRef.current = false;
    const loadingForOrderId = orderId;
    currentOrderIdRef.current = orderId;

    try {
      setLoading(true);
      await Promise.all([
        loadOrderDetails(loadingForOrderId),
        loadPayments(loadingForOrderId),
        loadPricingRules(),
      ]);
    } catch (err) {
      console.error('Error loading order data:', err);
    } finally {
      if (currentOrderIdRef.current === loadingForOrderId) {
        setLoading(false);
      }
      isLoadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        loadData();
      }
    }
  };

  const loadOrderDetails = async (forOrderId: string) => {
    const { data } = await getOrderById(forOrderId);
    if (data && currentOrderIdRef.current === forOrderId) {
      setOrder(data as any);
    }
  };

  const loadPayments = async (forOrderId: string) => {
    const { data } = await getOrderPayments(forOrderId);
    if (data && currentOrderIdRef.current === forOrderId) {
      setPayments(data as any[]);
    }
  };

  const loadPricingRules = async () => {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      setPricingRules(data as any);
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
