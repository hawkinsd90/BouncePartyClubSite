import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Users, ShoppingBag, CreditCard, Banknote, RotateCcw, Clock, Repeat, MapPin, Package, Star, AlertCircle, RefreshCw, Gauge, Car } from 'lucide-react';
import { useAdminAnalytics, useMileageAnalytics, AnalyticsPeriod } from '../../hooks/useAdminAnalytics';
import { LoadingSpinner } from '../common/LoadingSpinner';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function pct(a: number, b: number): string {
  if (b === 0) return '0%';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function trend(current: number, previous: number): { label: string; positive: boolean } | null {
  if (previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  const positive = change >= 0;
  return {
    label: `${positive ? '+' : ''}${change.toFixed(1)}% vs last month`,
    positive,
  };
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  trendInfo?: { label: string; positive: boolean } | null;
  accent?: string;
}

function StatCard({ icon, label, value, sub, trendInfo, accent = 'blue' }: StatCardProps) {
  const accentMap: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    cyan: 'text-cyan-600 bg-cyan-50',
    slate: 'text-slate-600 bg-slate-100',
  };
  const colors = accentMap[accent] || accentMap.blue;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors}`}>
          {icon}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900 leading-tight">{value}</div>
          {trendInfo && (
            <div className={`text-xs font-medium mt-1 ${trendInfo.positive ? 'text-green-600' : 'text-red-500'}`}>
              {trendInfo.positive ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
              {trendInfo.label}
            </div>
          )}
        </div>
      </div>
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function BusinessAnalytics() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('all_time');
  const { analytics: a, loading, error, reload } = useAdminAnalytics(period);
  const { mileage: m } = useMileageAnalytics(period);
  const [crewNames, setCrewNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!m || m.crew_breakdown.length === 0) return;
    (async () => {
      try {
        const { data: { session } } = await (await import('../../lib/supabase')).supabase.auth.getSession();
        if (!session?.access_token) return;
        const ids = m.crew_breakdown.map(c => c.user_id);
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-user-info`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: ids }),
          }
        );
        if (res.ok) {
          const { userInfo } = await res.json();
          const names: Record<string, string> = {};
          for (const id of ids) names[id] = userInfo[id]?.full_name || userInfo[id]?.email || 'Crew Member';
          setCrewNames(names);
        }
      } catch { /* non-critical */ }
    })();
  }, [m]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !a) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-slate-600">{error || 'No analytics data available'}</p>
        <button onClick={reload} className="mt-3 text-sm text-blue-600 hover:underline">Retry</button>
      </div>
    );
  }

  const revTrend = trend(a.revenue_this_month_cents, a.revenue_last_month_cents);
  const ordersTrend = trend(a.orders_this_month, a.orders_last_month);
  const tipRate = a.qualifying_orders > 0 ? ((a.orders_with_tips / a.qualifying_orders) * 100).toFixed(1) : '0';
  const repeatRate = a.total_customers_with_orders > 0
    ? `${((a.repeat_customers / a.total_customers_with_orders) * 100).toFixed(1)}%`
    : '0%';

  const totalPayments = a.cash_payments_cents + a.card_payments_cents;
  const cashPct = totalPayments > 0 ? ((a.cash_payments_cents / totalPayments) * 100).toFixed(0) : '0';
  const cardPct = totalPayments > 0 ? ((a.card_payments_cents / totalPayments) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Business Analytics</h2>
          <p className="text-sm text-slate-500 mt-0.5">Metrics from confirmed, active, and completed orders</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as AnalyticsPeriod)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-700"
          >
            <option value="all_time">All Time</option>
            <option value="1d">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="this_month">This Month ({new Date().toLocaleString('default', { month: 'short' })})</option>
            <option value="last_month">Last Month ({new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleString('default', { month: 'short' })})</option>
            <option value="2mo_ago">2 Months Ago ({new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toLocaleString('default', { month: 'short' })})</option>
          </select>
          <button
            onClick={reload}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Revenue Section */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Revenue</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Total Revenue"
            value={formatCents(a.total_revenue_cents)}
            sub="All confirmed orders"
            accent="green"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Revenue This Month"
            value={formatCents(a.revenue_this_month_cents)}
            trendInfo={revTrend}
            accent="blue"
          />
          <StatCard
            icon={<ShoppingBag className="w-5 h-5" />}
            label="Avg Order Value"
            value={formatCents(a.avg_order_value_cents)}
            sub="Qualifying orders only"
            accent="cyan"
          />
          <StatCard
            icon={<Star className="w-5 h-5" />}
            label="Tips Collected"
            value={formatCents(a.total_tips_cents)}
            sub={`${tipRate}% tip rate`}
            accent="amber"
          />
        </div>
      </div>

      {/* Payments Section */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Payments & Balances</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<CreditCard className="w-5 h-5" />}
            label="Deposits Collected"
            value={formatCents(a.total_deposits_collected_cents)}
            sub="From all qualifying orders"
            accent="blue"
          />
          <StatCard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Balance Still Owed"
            value={formatCents(a.total_balance_owed_cents)}
            sub="Active orders only"
            accent={a.total_balance_owed_cents > 0 ? 'amber' : 'green'}
          />
          <StatCard
            icon={<RotateCcw className="w-5 h-5" />}
            label="Refunds Issued"
            value={formatCents(a.total_refunds_cents)}
            accent={a.total_refunds_cents > 0 ? 'red' : 'slate'}
          />
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-600 bg-slate-100">
                <Banknote className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-slate-800">Cash vs Card Split</div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Card</span>
                <span className="font-semibold text-slate-900">{cardPct}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${cardPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Cash</span>
                <span className="font-semibold text-slate-900">{cashPct}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Orders Section */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Orders</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<ShoppingBag className="w-5 h-5" />}
            label="Total Orders"
            value={a.total_orders.toString()}
            sub="All non-draft/void orders"
            accent="blue"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Orders This Month"
            value={a.orders_this_month.toString()}
            trendInfo={ordersTrend}
            accent="green"
          />
          <StatCard
            icon={<Clock className="w-5 h-5" />}
            label="Avg Lead Time"
            value={`${a.avg_lead_time_days} days`}
            sub="Order placed to event date"
            accent="cyan"
          />
          <StatCard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Cancellation Rate"
            value={pct(a.cancelled_orders, a.total_orders)}
            sub={`${a.cancelled_orders} of ${a.total_orders} orders`}
            accent={a.cancelled_orders > 0 ? 'amber' : 'green'}
          />
        </div>
      </div>

      {/* Customers Section */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Customers</h3>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Unique Customers"
            value={a.total_customers_with_orders.toString()}
            sub="With at least 1 qualifying order"
            accent="blue"
          />
          <StatCard
            icon={<Repeat className="w-5 h-5" />}
            label="Repeat Customer Rate"
            value={repeatRate}
            sub={`${a.repeat_customers} customers with 2+ orders`}
            accent="green"
          />
        </div>
      </div>

      {/* Top Units & Top Cities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Units */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-900">Top Units by Revenue</h3>
          </div>
          {a.top_units.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet</p>
          ) : (
            <div className="space-y-3">
              {a.top_units.slice(0, 8).map((unit, i) => (
                <div key={unit.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-400 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{unit.name}</div>
                    <div className="text-xs text-slate-500">{unit.bookings} bookings</div>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 shrink-0">
                    {formatCents(unit.revenue_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Cities */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">Top Cities by Orders</h3>
          </div>
          {a.top_cities.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet</p>
          ) : (
            <div className="space-y-3">
              {a.top_cities.slice(0, 8).map((city, i) => {
                const maxCount = a.top_cities[0].count;
                return (
                  <div key={city.city} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-900 truncate">{city.city}</span>
                        <span className="text-sm font-semibold text-slate-900 ml-2 shrink-0">{city.count}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${(city.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mileage Section */}
      {m && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Fleet Mileage</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <StatCard
              icon={<Gauge className="w-5 h-5" />}
              label="Total Miles Driven"
              value={m.total_miles.toLocaleString()}
              sub="All crew, logged days only"
              accent="blue"
            />
            <StatCard
              icon={<Car className="w-5 h-5" />}
              label="Days with Mileage"
              value={m.total_days.toString()}
              sub="Unique work days logged"
              accent="green"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Avg Miles / Day"
              value={m.avg_miles_per_day.toLocaleString()}
              sub="Across logged work days"
              accent="cyan"
            />
          </div>
          {m.crew_breakdown.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Car className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-slate-900">Mileage by Crew Member</h3>
              </div>
              <div className="space-y-3">
                {m.crew_breakdown.map(crew => {
                  const maxMiles = m.crew_breakdown[0].total_miles;
                  return (
                    <div key={crew.user_id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {crewNames[crew.user_id] || 'Crew Member'}
                          </span>
                          <div className="flex items-center gap-3 ml-2 shrink-0">
                            <span className="text-xs text-slate-500">{crew.days} day{crew.days !== 1 ? 's' : ''}</span>
                            <span className="text-sm font-semibold text-slate-900">{crew.total_miles.toLocaleString()} mi</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: maxMiles > 0 ? `${(crew.total_miles / maxMiles) * 100}%` : '0%' }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cancellation Reasons */}
      {a.cancellation_reasons.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-slate-900">Cancellation Reasons</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {a.cancellation_reasons.map((r) => (
              <div key={r.reason} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-700 truncate">{r.reason}</span>
                <span className="text-sm font-semibold text-slate-900 ml-2 shrink-0">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
