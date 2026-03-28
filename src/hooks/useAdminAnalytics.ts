import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export type AnalyticsPeriod = 'all_time' | '1d' | '7d' | '30d' | '90d' | 'this_month' | 'last_month' | '2mo_ago';

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

function getPeriodRange(period: AnalyticsPeriod): { start: string | null; end: string | null } {
  const now = new Date();
  if (period === 'all_time') return { start: null, end: null };
  if (period === '1d') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (period === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (period === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (period === '90d') {
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (period === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (period === '2mo_ago') {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: null, end: null };
}

export function useAdminAnalytics(period: AnalyticsPeriod = 'all_time') {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [period]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getPeriodRange(period);
      const { data, error: rpcError } = await supabase.rpc('get_admin_analytics', {
        p_start: start,
        p_end: end,
      });
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
