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

// Only include events that are actually tracked in the codebase.
// page_view and payment_link_opened are defined in the type but never called —
// they are intentionally excluded here until implemented.
const EVENT_LABELS: Record<string, string> = {
  unit_view: 'Unit Views',
  quote_started: 'Quotes Started',
  quote_submitted: 'Quotes Submitted',
  checkout_started: 'Checkouts Started',
  checkout_completed: 'Checkouts Completed',
  customer_portal_viewed: 'Portal Views',
  waiver_link_opened: 'Waiver Links Opened',
};

// Conversion funnel — only steps that are actually tracked.
// Top of funnel is unit_view (the first measurable intent signal we capture).
const FUNNEL_EVENTS = [
  'unit_view',
  'quote_started',
  'quote_submitted',
  'checkout_started',
  'checkout_completed',
];

export function SiteAnalytics() {
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    load();
  }, [days]);

  async function load() {
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [allEventsRes, unitsRes, recentRes, todayRes] = await Promise.all([
        supabase
          .from('site_events')
          .select('event_name')
          .gte('created_at', since),
        supabase
          .from('site_events')
          .select('unit_id, units(name)')
          .eq('event_name', 'unit_view')
          .gte('created_at', since)
          .not('unit_id', 'is', null),
        supabase
          .from('site_events')
          .select('event_name, page_path, created_at, metadata')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('site_events')
          .select('session_id, event_name')
          .gte('created_at', todayStart.toISOString()),
      ]);

      // Count all events by name
      const allCounts: Record<string, number> = {};
      for (const row of (allEventsRes.data || [])) {
        allCounts[row.event_name] = (allCounts[row.event_name] || 0) + 1;
      }

      // Build funnel from tracked events only
      const funnel: FunnelRow[] = FUNNEL_EVENTS.map(name => ({
        event_name: name,
        count: allCounts[name] || 0,
      }));

      // All event type counts (for the summary panel)
      const allEventCounts: EventCount[] = Object.entries(allCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([event_name, count]) => ({ event_name, count }));

      // Top units viewed
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

  // Use the top tracked funnel step as the bar-width base, not index 0.
  // This keeps the bars honest: the widest bar is 100%, others are proportional.
  const maxFunnel = Math.max(...metrics.funnel.map(r => r.count), 1);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Site Activity</h2>
          <p className="text-sm text-slate-500 mt-0.5">Visitor funnel and engagement tracking</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Today Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">Sessions Today</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{metrics.totalSessionsToday}</div>
          <p className="text-xs text-slate-400 mt-1">Unique session IDs from tracked events</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
              <Activity className="w-4 h-4 text-green-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">Events Today</span>
          </div>
          <div className="text-3xl font-bold text-slate-900">{metrics.totalEventsToday}</div>
          <p className="text-xs text-slate-400 mt-1">All tracked event types combined</p>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-900">Conversion Funnel</h3>
            <span className="text-xs text-slate-400 ml-1">({days}d)</span>
          </div>
          <p className="text-xs text-slate-400 max-w-xs text-right">
            Only tracked events are shown. Page views are not yet instrumented.
          </p>
        </div>
        {maxFunnel === 1 && metrics.funnel.every(r => r.count === 0) ? (
          <p className="text-sm text-slate-500">No funnel events recorded in this period yet.</p>
        ) : (
          <div className="space-y-3">
            {metrics.funnel.map((row, i) => {
              const prev = i > 0 ? metrics.funnel[i - 1].count : row.count;
              const convPct = prev > 0 ? `${((row.count / prev) * 100).toFixed(0)}%` : '—';
              return (
                <div key={row.event_name} className="flex items-center gap-3">
                  <div className="w-36 text-xs text-slate-600 shrink-0">
                    {EVENT_LABELS[row.event_name] || row.event_name}
                  </div>
                  <div className="flex-1">
                    <div className="w-full bg-slate-100 rounded-full h-6 relative overflow-hidden">
                      <div
                        className="h-6 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                        style={{ width: `${(row.count / maxFunnel) * 100}%` }}
                      />
                      <span className="absolute inset-0 flex items-center pl-2 text-xs font-semibold text-slate-700 mix-blend-normal">
                        {row.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {i > 0 && (
                    <div className="w-14 text-right text-xs text-slate-500 shrink-0">{convPct}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Units Viewed */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingCart className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">Most Viewed Units</h3>
          </div>
          {metrics.topUnits.length === 0 ? (
            <p className="text-sm text-slate-500">No unit views recorded yet</p>
          ) : (
            <div className="space-y-2">
              {metrics.topUnits.map(u => (
                <div key={u.unit_name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-sm text-slate-700 truncate">{u.unit_name}</span>
                  <span className="text-sm font-semibold text-slate-900 ml-2 shrink-0">{u.views.toLocaleString()} views</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* All Event Type Counts */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-900">Events by Type</h3>
          </div>
          {metrics.allEventCounts.length === 0 ? (
            <p className="text-sm text-slate-500">No events recorded yet</p>
          ) : (
            <div className="space-y-2">
              {metrics.allEventCounts.map(e => (
                <div key={e.event_name} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-sm text-slate-700 truncate">
                    {EVENT_LABELS[e.event_name] || e.event_name}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 ml-2 shrink-0">{e.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-slate-600" />
          <h3 className="font-semibold text-slate-900">Recent Activity</h3>
        </div>
        {metrics.recentEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No events recorded yet</p>
        ) : (
          <div className="space-y-2">
            {metrics.recentEvents.map((e, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                <span className="text-sm font-medium text-slate-800 w-44 shrink-0">
                  {EVENT_LABELS[e.event_name] || e.event_name}
                </span>
                <span className="text-sm text-slate-500 font-mono truncate">{e.page_path || '—'}</span>
                <span className="text-xs text-slate-400 shrink-0 ml-auto">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
