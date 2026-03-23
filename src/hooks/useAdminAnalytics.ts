import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminAnalytics {
  total_revenue_cents: number;
  revenue_this_month_cents: number;
  revenue_last_month_cents: number;
  avg_order_value_cents: number;
  total_tips_cents: number;
  orders_with_tips: number;
  total_deposits_collected_cents: number;
  total_balance_owed_cents: number;
  cash_payments_cents: number;
  card_payments_cents: number;
  total_refunds_cents: number;
  total_orders: number;
  qualifying_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  pending_review_orders: number;
  orders_this_month: number;
  orders_last_month: number;
  avg_lead_time_days: number;
  repeat_customers: number;
  total_customers_with_orders: number;
  cancellation_reasons: Array<{ reason: string; count: number }>;
  top_cities: Array<{ city: string; count: number }>;
  top_units: Array<{ name: string; revenue_cents: number; bookings: number }>;
}

export function useAdminAnalytics() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_admin_analytics');
      if (rpcError) throw rpcError;
      setAnalytics(data as AdminAnalytics);
    } catch (err) {
      console.error('Failed to load admin analytics:', err);
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  return { analytics, loading, error, reload: load };
}
