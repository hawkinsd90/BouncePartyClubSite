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

export interface MileageAnalytics {
  total_miles: number;
  total_days: number;
  avg_miles_per_day: number;
  crew_breakdown: Array<{ user_id: string; total_miles: number; days: number }>;
}

export function useMileageAnalytics(period: AnalyticsPeriod = 'all_time') {
  const [mileage, setMileage] = useState<MileageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [period]);

  async function load() {
    setLoading(true);
    try {
      const { start, end } = getPeriodRange(period);
      let query = supabase
        .from('daily_mileage_logs')
        .select('user_id, start_mileage, end_mileage, date')
        .not('start_mileage', 'is', null)
        .not('end_mileage', 'is', null);

      if (start) query = query.gte('date', start.split('T')[0]);
      if (end) query = query.lte('date', end.split('T')[0]);

      const { data, error } = await query;
      if (error || !data) { setMileage(null); return; }

      const byUser: Record<string, { total_miles: number; days: number }> = {};
      let totalMiles = 0;

      for (const row of data) {
        const miles = (row.end_mileage as number) - (row.start_mileage as number);
        if (miles <= 0) continue;
        totalMiles += miles;
        if (!byUser[row.user_id]) byUser[row.user_id] = { total_miles: 0, days: 0 };
        byUser[row.user_id].total_miles += miles;
        byUser[row.user_id].days += 1;
      }

      const crew_breakdown = Object.entries(byUser).map(([user_id, stats]) => ({
        user_id,
        total_miles: Math.round(stats.total_miles * 10) / 10,
        days: stats.days,
      })).sort((a, b) => b.total_miles - a.total_miles);

      const total_days = new Set(data.map(r => r.date as string)).size;

      setMileage({
        total_miles: Math.round(totalMiles * 10) / 10,
        total_days,
        avg_miles_per_day: total_days > 0 ? Math.round((totalMiles / total_days) * 10) / 10 : 0,
        crew_breakdown,
      });
    } catch {
      setMileage(null);
    } finally {
      setLoading(false);
    }
  }

  return { mileage, loading };
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
        p_start: start ?? undefined,
        p_end: end ?? undefined,
      });
      if (rpcError) throw rpcError;
      setAnalytics(data as unknown as AdminAnalytics);
    } catch (err) {
      console.error('Failed to load admin analytics:', err);
      setError('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  return { analytics, loading, error, reload: load };
}
