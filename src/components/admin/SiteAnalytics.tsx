import { useState, useEffect } from 'react';
import { Activity, ShoppingCart, CreditCard, Users, TrendingUp, RefreshCw, BarChart2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface FunnelRow {
  event_name: string;
  count: number;
}

interface TopUnit {
  unit_name: string;
  views: number;
}

interface RecentEvent {
  event_name: string;
  page_path: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface EventCount {
  event_name: string;
  count: number;
}

interface SiteMetrics {
  funnel: FunnelRow[];
  topUnits: TopUnit[];
  recentEvents: RecentEvent[];
  allEventCounts: EventCount[];
  totalSessionsToday: number;
  totalEventsToday: number;
}

const EVENT_LABELS: Record<string, string> = {
  unit_view: 'Unit Views',
  quote_started: 'Quote Requests Started',
  quote_submitted: 'Cart Submitted (to Checkout)',
  checkout_started: 'Checkouts Started',
  checkout_completed: 'Checkouts Completed',
  customer_portal_viewed: 'Portal Views',
  waiver_link_opened: 'Waiver Links Opened',
};

const FUNNEL_EVENTS = [
  'unit_view',
  'quote_started',
  'quote_submitted',
  'checkout_started',
  'checkout_completed',
];

type PeriodKey = '1d' | '7d' | '30d' | '90d' | 'this_month' | 'last_month' | '2mo_ago';

function getPeriodRange(period: PeriodKey): { since: string; until: string | null; label: string } {
  const now = new Date();
  if (period === '1d') {
    return {
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      until: null,
      label: 'Last 24 hours',
    };
  }
  if (period === '7d') {
    return {
      since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      until: null,
      label: 'Last 7 days',
    };
  }
  if (period === '30d') {
    return {
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      until: null,
      label: 'Last 30 days',
    };
  }
  if (period === '90d') {
    return {
      since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      until: null,
      label: 'Last 90 days',
    };
  }
  if (period === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { since: start.toISOString(), until: null, label: 'This Month' };
  }
  if (period === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { since: start.toISOString(), until: end.toISOString(), label: 'Last Month' };
  }
  // 2mo_ago
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { since: start.toISOString(), until: end.toISOString(), label: '2 Months Ago' };
}

export function SiteAnalytics() {
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>('30d');

  useEffect(() => {
    load();
  }, [period]);

  async function load() {
    setLoading(true);
    try {
      const { since, until } = getPeriodRange(period);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      let allEventsQuery = supabase.from('site_events').select('event_name').gte('created_at', since);
      if (until) allEventsQuery = allEventsQuery.lt('created_at', until);

      let unitsQuery = supabase.from('site_events').select('unit_id, units(name)').eq('event_name', 'unit_view').gte('created_at', since).not('unit_id', 'is', null);
      if (until) unitsQuery = unitsQuery.lt('created_at', until);

      let recentQuery = supabase.from('site_events').select('event_name, page_path, created_at, metadata').gte('created_at', since).order('created_at', { ascending: false }).limit(20);
      if (until) recentQuery = recentQuery.lt('created_at', until);

      const [allEventsRes, unitsRes, recentRes, todayRes] = await Promise.all([
        allEventsQuery,
        unitsQuery,
        recentQuery,
        supabase
          .from('site_events')
          .select('session_id, event_name')
          .gte('created_at', todayStart.toISOString()),
      ]);

      const allCounts: Record<string, number> = {};
      for (const row of (allEventsRes.data || [])) {
        allCounts[row.event_name] = (allCounts[row.event_name] || 0) + 1;
      }

      const funnel: FunnelRow[] = FUNNEL_EVENTS.map(name => ({
        event_name: name,
        count: allCounts[name] || 0,
      }));

      const allEventCounts: EventCount[] = Object.entries(allCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([event_name, count]) => ({ event_name, count }));

      const unitCounts: Record<string, number> = {};
      for (const row of (unitsRes.data || [])) {
        const unitName = (row.units as any)?.name || 'Unknown';
        unitCounts[unitName] = (unitCounts[unitName] || 0) + 1;
      }
      const topUnits: TopUnit[] = Object.entries(unitCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([unit_name, views]) => ({ unit_name, views }));

      const todayData = todayRes.data || [];
      const uniqueSessions = new Set(todayData.map(r => r.session_id).filter(Boolean)).size;

      setMetrics({
        funnel,
        topUnits,
        recentEvents: (recentRes.data || []) as RecentEvent[],
        allEventCounts,
        totalSessionsToday: uniqueSessions,
        totalEventsToday: todayData.length,
      });
    } catch (err) {
      console.error('Failed to load site analytics:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 text-center">
        <p className="text-slate-600">No site activity data available yet.</p>
        <p className="text-sm text-slate-500 mt-1">Events will appear here as visitors use the site.</p>
      </div>
    );
  }

  const maxFunnel = Math.max(...metrics.funnel.map(r => r.count), 1);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Site Activity</h2>
          <p className="text-sm text-slate-500 mt-0.5">Visitor funnel and engagement tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as PeriodKey)}
            className="flex-1 sm:flex-none text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="1d">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="this_month">This Month ({new Date().toLocaleString('default', { month: 'short' })})</option>
            <option value="last_month">Last Month ({new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleString('default', { month: 'short' })})</option>
            <option value="2mo_ago">2 Months Ago ({new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toLocaleString('default', { month: 'short' })})</option>
          </select>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Today Summary */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-xs sm:text-sm font-medium text-slate-600 leading-tight">Sessions Today</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900">{metrics.totalSessionsToday}</div>
          <p className="text-xs text-slate-400 mt-1 hidden sm:block">Unique session IDs from tracked events</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-green-600" />
            </div>
            <span className="text-xs sm:text-sm font-medium text-slate-600 leading-tight">Events Today</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-slate-900">{metrics.totalEventsToday}</div>
          <p className="text-xs text-slate-400 mt-1 hidden sm:block">All tracked event types combined</p>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-900">Conversion Funnel</h3>
          <span className="text-xs text-slate-400 ml-1">({getPeriodRange(period).label})</span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Only tracked events are shown. Page views are not yet instrumented.
        </p>
        {maxFunnel === 1 && metrics.funnel.every(r => r.count === 0) ? (
          <p className="text-sm text-slate-500">No funnel events recorded in this period yet.</p>
        ) : (
          <div className="space-y-3">
            {metrics.funnel.map((row, i) => {
              const prev = i > 0 ? metrics.funnel[i - 1].count : row.count;
              const convPct = prev > 0 ? `${((row.count / prev) * 100).toFixed(0)}%` : '—';
              return (
                <div key={row.event_name}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs font-medium text-slate-600 truncate">
                      {EVENT_LABELS[row.event_name] || row.event_name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-bold text-slate-900">{row.count.toLocaleString()}</span>
                      {i > 0 && (
                        <span className="text-xs text-slate-400 w-10 text-right">{convPct}</span>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="h-5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                      style={{ width: `${(row.count / maxFunnel) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Two-column grid — stacks on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Top Units Viewed */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingCart className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">Most Viewed Units</h3>
          </div>
          {metrics.topUnits.length === 0 ? (
            <p className="text-sm text-slate-500">No unit views recorded yet</p>
          ) : (
            <div className="space-y-2">
              {metrics.topUnits.map(u => (
                <div key={u.unit_name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 gap-2">
                  <span className="text-sm text-slate-700 truncate min-w-0">{u.unit_name}</span>
                  <span className="text-sm font-semibold text-slate-900 shrink-0">{u.views.toLocaleString()} views</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* All Event Type Counts */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-900">Events by Type</h3>
          </div>
          {metrics.allEventCounts.length === 0 ? (
            <p className="text-sm text-slate-500">No events recorded yet</p>
          ) : (
            <div className="space-y-2">
              {metrics.allEventCounts.map(e => (
                <div key={e.event_name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 gap-2">
                  <span className="text-sm text-slate-700 truncate min-w-0">
                    {EVENT_LABELS[e.event_name] || e.event_name}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 shrink-0">{e.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-slate-600" />
          <h3 className="font-semibold text-slate-900">Recent Activity</h3>
        </div>
        {metrics.recentEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No events recorded yet</p>
        ) : (
          <div className="space-y-0 divide-y divide-slate-100">
            {metrics.recentEvents.map((e, i) => (
              <div key={i} className="py-2.5">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {EVENT_LABELS[e.event_name] || e.event_name}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {e.page_path && (
                  <p className="text-xs text-slate-400 font-mono pl-4 truncate">{e.page_path}</p>
                )}
                <p className="text-xs text-slate-300 pl-4">
                  {new Date(e.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
