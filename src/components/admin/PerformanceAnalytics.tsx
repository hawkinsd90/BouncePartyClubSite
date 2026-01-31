import { useEffect, useState } from 'react';
import { Clock, TrendingUp, TrendingDown, Target, Activity, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface PerformanceMetrics {
  avgDeliveryMinutes: number | null;
  avgSetupMinutes: number | null;
  avgTeardownMinutes: number | null;
  avgPickupMinutes: number | null;
  totalCompletedTasks: number;
  taskCompletionRate: number;
  onTimeDeliveryRate: number;
  avgTotalServiceMinutes: number | null;
  tasksLast30Days: number;
  tasksCompletedToday: number;
}

export function PerformanceAnalytics() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  async function loadMetrics() {
    try {
      const { data: taskData, error } = await supabase
        .from('task_status')
        .select(`
          *,
          orders!inner(status)
        `)
        .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

      if (error) throw error;

      const tasks = taskData || [];
      const completedTasks = tasks.filter(t => t.pickup_completed_at);
      const totalTasks = tasks.length;

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const tasksLast30Days = tasks.filter(t => new Date(t.created_at) >= thirtyDaysAgo).length;
      const tasksCompletedToday = tasks.filter(t =>
        t.pickup_completed_at && new Date(t.pickup_completed_at) >= today
      ).length;

      let totalDeliveryMinutes = 0;
      let deliveryCount = 0;
      let totalSetupMinutes = 0;
      let setupCount = 0;
      let totalTeardownMinutes = 0;
      let teardownCount = 0;
      let totalPickupMinutes = 0;
      let pickupCount = 0;
      let totalServiceMinutes = 0;
      let serviceCount = 0;
      let onTimeDeliveries = 0;

      completedTasks.forEach(task => {
        if (task.delivery_started_at && task.delivery_completed_at) {
          const deliveryMinutes = (new Date(task.delivery_completed_at).getTime() - new Date(task.delivery_started_at).getTime()) / 60000;
          totalDeliveryMinutes += deliveryMinutes;
          deliveryCount++;

          if (task.delivery_eta && new Date(task.delivery_completed_at) <= new Date(task.delivery_eta)) {
            onTimeDeliveries++;
          }
        }

        if (task.setup_started_at && task.setup_completed_at) {
          const setupMinutes = (new Date(task.setup_completed_at).getTime() - new Date(task.setup_started_at).getTime()) / 60000;
          totalSetupMinutes += setupMinutes;
          setupCount++;
        }

        if (task.teardown_started_at && task.teardown_completed_at) {
          const teardownMinutes = (new Date(task.teardown_completed_at).getTime() - new Date(task.teardown_started_at).getTime()) / 60000;
          totalTeardownMinutes += teardownMinutes;
          teardownCount++;
        }

        if (task.pickup_started_at && task.pickup_completed_at) {
          const pickupMinutes = (new Date(task.pickup_completed_at).getTime() - new Date(task.pickup_started_at).getTime()) / 60000;
          totalPickupMinutes += pickupMinutes;
          pickupCount++;
        }

        if (task.delivery_started_at && task.pickup_completed_at) {
          const totalMinutes = (new Date(task.pickup_completed_at).getTime() - new Date(task.delivery_started_at).getTime()) / 60000;
          totalServiceMinutes += totalMinutes;
          serviceCount++;
        }
      });

      setMetrics({
        avgDeliveryMinutes: deliveryCount > 0 ? totalDeliveryMinutes / deliveryCount : null,
        avgSetupMinutes: setupCount > 0 ? totalSetupMinutes / setupCount : null,
        avgTeardownMinutes: teardownCount > 0 ? totalTeardownMinutes / teardownCount : null,
        avgPickupMinutes: pickupCount > 0 ? totalPickupMinutes / pickupCount : null,
        totalCompletedTasks: completedTasks.length,
        taskCompletionRate: totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 0,
        onTimeDeliveryRate: deliveryCount > 0 ? (onTimeDeliveries / deliveryCount) * 100 : 0,
        avgTotalServiceMinutes: serviceCount > 0 ? totalServiceMinutes / serviceCount : null,
        tasksLast30Days,
        tasksCompletedToday,
      });
    } catch (error) {
      console.error('Failed to load performance metrics:', error);
    } finally {
      setLoading(false);
    }
  }

  function formatDuration(minutes: number | null) {
    if (minutes === null) return 'N/A';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
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
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <p className="text-slate-600 text-center">Unable to load performance metrics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl p-8 text-white">
        <h2 className="text-2xl font-bold mb-2">Performance Analytics</h2>
        <p className="text-blue-100">Last 90 days of operational metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <Clock className="w-8 h-8 text-blue-600" />
            <span className="text-2xl font-bold text-slate-900">
              {formatDuration(metrics.avgDeliveryMinutes)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Avg Delivery Time</h3>
          <p className="text-xs text-slate-600">Time from departure to arrival</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <Activity className="w-8 h-8 text-green-600" />
            <span className="text-2xl font-bold text-slate-900">
              {formatDuration(metrics.avgSetupMinutes)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Avg Setup Time</h3>
          <p className="text-xs text-slate-600">Time to complete setup</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <TrendingDown className="w-8 h-8 text-amber-600" />
            <span className="text-2xl font-bold text-slate-900">
              {formatDuration(metrics.avgTeardownMinutes)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Avg Teardown Time</h3>
          <p className="text-xs text-slate-600">Time to break down equipment</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100 hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <TrendingUp className="w-8 h-8 text-cyan-600" />
            <span className="text-2xl font-bold text-slate-900">
              {formatDuration(metrics.avgPickupMinutes)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Avg Pickup Time</h3>
          <p className="text-xs text-slate-600">Time to load and depart</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Task Completion Rate</h3>
                <p className="text-sm text-slate-600">Tasks fully completed</p>
              </div>
            </div>
            <span className="text-3xl font-bold text-green-600">
              {metrics.taskCompletionRate.toFixed(1)}%
            </span>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Total Completed:</span>
              <span className="font-semibold text-slate-900">{metrics.totalCompletedTasks}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Target className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">On-Time Delivery</h3>
                <p className="text-sm text-slate-600">Deliveries within ETA</p>
              </div>
            </div>
            <span className="text-3xl font-bold text-blue-600">
              {metrics.onTimeDeliveryRate.toFixed(1)}%
            </span>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Avg Total Service:</span>
              <span className="font-semibold text-slate-900">
                {formatDuration(metrics.avgTotalServiceMinutes)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-100">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <Activity className="w-6 h-6 text-slate-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Recent Activity</h3>
            <p className="text-sm text-slate-600">Task volume trends</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-slate-50 rounded-lg">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              {metrics.tasksCompletedToday}
            </div>
            <div className="text-sm text-slate-600">Tasks Completed Today</div>
          </div>

          <div className="text-center p-4 bg-slate-50 rounded-lg">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              {metrics.tasksLast30Days}
            </div>
            <div className="text-sm text-slate-600">Tasks Last 30 Days</div>
          </div>

          <div className="text-center p-4 bg-slate-50 rounded-lg">
            <div className="text-3xl font-bold text-slate-900 mb-1">
              {metrics.tasksLast30Days > 0 ? (metrics.tasksLast30Days / 30).toFixed(1) : '0'}
            </div>
            <div className="text-sm text-slate-600">Avg Tasks Per Day</div>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-amber-600 mt-1 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-amber-900 mb-2">Performance Insights</h4>
            <ul className="space-y-2 text-sm text-amber-800">
              {metrics.avgDeliveryMinutes && metrics.avgDeliveryMinutes > 45 && (
                <li>• Delivery times averaging over 45 minutes - consider route optimization</li>
              )}
              {metrics.avgSetupMinutes && metrics.avgSetupMinutes > 60 && (
                <li>• Setup times averaging over 1 hour - crew may benefit from additional training</li>
              )}
              {metrics.onTimeDeliveryRate < 80 && (
                <li>• On-time delivery rate below 80% - review ETA calculation and traffic factors</li>
              )}
              {metrics.taskCompletionRate < 90 && (
                <li>• Task completion rate below 90% - investigate incomplete tasks</li>
              )}
              {metrics.avgDeliveryMinutes && metrics.avgSetupMinutes &&
               metrics.avgTeardownMinutes && metrics.avgPickupMinutes &&
               metrics.avgDeliveryMinutes < 30 && metrics.avgSetupMinutes < 45 &&
               metrics.avgTeardownMinutes < 30 && metrics.avgPickupMinutes < 20 && (
                <li>• All performance metrics are within optimal ranges - excellent work!</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
