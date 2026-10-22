import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { getOrderById, getOrderPayments } from '../../lib/queries/orders';
import type { Database } from '../../lib/database.types';
import type { AdminOrderRecord } from '../../lib/orders/adminOrderRecord';

type Tables = Database['public']['Tables'];

// The rows exactly as the three loads return them: the order with the relations STANDARD_ORDER_SELECT embeds, the payments rows (select *) and the
// pricing_rules row (select *). These replace interfaces that listed columns the tables do not have (amount / payment_type, base_delivery_fee ...).
type Payment = Tables['payments']['Row'];
type PricingRule = Tables['pricing_rules']['Row'];

export function useAdminOrderDetails(orderId: string | null) {
  const [order, setOrder] = useState<AdminOrderRecord | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed load must not look like "no payments / $0 paid": the screens show a message and a Retry instead.
  const [loadError, setLoadError] = useState(false);
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
      setLoadError(false);
      await Promise.all([
        loadOrderDetails(loadingForOrderId),
        loadPayments(loadingForOrderId),
        loadPricingRules(),
      ]);
    } catch (err) {
      console.error('Error loading order data:', err);
      if (currentOrderIdRef.current === loadingForOrderId) setLoadError(true);
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
    const { data, error } = await getOrderById(forOrderId);
    if (error) throw error;
    if (data && currentOrderIdRef.current === forOrderId) {
      setOrder(data as unknown as AdminOrderRecord);
    }
  };

  const loadPayments = async (forOrderId: string) => {
    const { data, error } = await getOrderPayments(forOrderId);
    if (error) throw error;
    if (data && currentOrderIdRef.current === forOrderId) {
      setPayments(data as Payment[]);
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
      setPricingRules(data);
    }
  };

  return {
    order,
    payments,
    pricingRules,
    loading,
    loadError,
    reload: loadData,
    setOrder,
    setPayments,
  };
}
