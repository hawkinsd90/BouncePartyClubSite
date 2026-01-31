import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { History, Package, Settings, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { notify, notifyError } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatOrderId } from '../../lib/utils';

interface OrderChange {
  id: string;
  order_id: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  created_at: string;
  changed_by: string | null;
}

interface GroupedOrderChange {
  order_id: string;
  customer_name: string;
  change_count: number;
  latest_timestamp: string;
  latest_user_email: string;
  changes: Array<{
    id: string;
    field_name: string;
    old_value: string | null;
    new_value: string | null;
    change_type: string;
    timestamp: string;
    user_email: string;
  }>;
}

interface ChangelogEntry {
  id: string;
  type: 'order' | 'setting' | 'contact';
  timestamp: string;
  user_email: string;
  title: string;
  description: string;
  old_value?: string;
  new_value?: string;
  details: any;
}

export function ChangelogTab() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [groupedOrders, setGroupedOrders] = useState<GroupedOrderChange[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'order' | 'setting' | 'contact'>('all');
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    fetchChangelog();
  }, [limit]);

  async function fetchChangelog() {
    setLoading(true);
    try {
      const allEntries: ChangelogEntry[] = [];

      // Fetch order changes
      const { data: orderChanges, error: orderError } = await supabase
        .from('order_changelog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (orderError) throw orderError;

      // Fetch admin settings changes
      const { data: settingChanges, error: settingError } = await supabase
        .from('admin_settings_changelog' as any)
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(limit);

      if (settingError) throw settingError;

      // Collect all unique user IDs
      const userIds = new Set<string>();
      (orderChanges || []).forEach(change => {
        if (change.changed_by) userIds.add(change.changed_by);
      });
      (settingChanges || []).forEach(change => {
        if (change.changed_by) userIds.add(change.changed_by);
      });

      // Fetch user info for all users
      let userInfo: Record<string, { email: string; full_name: string }> = {};
      if (userIds.size > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-user-info`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ user_ids: Array.from(userIds) }),
              }
            );

            if (response.ok) {
              const data = await response.json();
              userInfo = data.userInfo || {};
            }
          } catch (err) {
            console.error('Failed to fetch user info:', err);
          }
        }
      }

      // Group order changes by order_id
      const orderGroups = new Map<string, {
        order_id: string;
        changes: OrderChange[];
      }>();

      for (const change of orderChanges || []) {
        if (!orderGroups.has(change.order_id)) {
          orderGroups.set(change.order_id, {
            order_id: change.order_id,
            changes: []
          });
        }
        orderGroups.get(change.order_id)!.changes.push(change);
      }

      // Create grouped order entries
      const grouped: GroupedOrderChange[] = [];
      for (const [order_id, group] of orderGroups) {
        const { data: orderData } = await supabase
          .from('orders')
          .select('id, customers(first_name, last_name)')
          .eq('id', order_id)
          .maybeSingle();

        const customerName = orderData?.customers
          ? `${(orderData.customers as any).first_name} ${(orderData.customers as any).last_name}`
          : 'Unknown Customer';

        // Sort changes by timestamp descending
        group.changes.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        const latestChange = group.changes[0];
        const latestUserEmail = latestChange.changed_by
          ? userInfo[latestChange.changed_by]?.email || 'Unknown User'
          : 'System';

        grouped.push({
          order_id,
          customer_name: customerName,
          change_count: group.changes.length,
          latest_timestamp: latestChange.created_at,
          latest_user_email: latestUserEmail,
          changes: group.changes.map(change => ({
            id: change.id,
            field_name: change.field_name || 'Order modified',
            old_value: change.old_value,
            new_value: change.new_value,
            change_type: change.change_type,
            timestamp: change.created_at,
            user_email: change.changed_by
              ? userInfo[change.changed_by]?.email || 'Unknown User'
              : 'System'
          }))
        });
      }

      setGroupedOrders(grouped);

      // Process admin settings changes
      for (const change of settingChanges || []) {
        const userEmail = change.changed_by
          ? userInfo[change.changed_by]?.email || 'Unknown User'
          : 'System';

        allEntries.push({
          id: change.id,
          type: 'setting',
          timestamp: change.changed_at,
          user_email: userEmail,
          title: `Setting Changed: ${change.setting_key}`,
          description: change.change_reason || 'Setting updated',
          old_value: change.old_value,
          new_value: change.new_value,
          details: { setting_key: change.setting_key }
        });
      }

      // Sort all entries by timestamp
      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setEntries(allEntries);
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter(e => e.type === filter);

  const filteredGroupedOrders = filter === 'all' || filter === 'order'
    ? groupedOrders
    : [];

  const toggleOrderExpansion = (orderId: string) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);
    }
    setExpandedOrders(newExpanded);
  };

  function getIcon(type: string) {
    switch (type) {
      case 'order': return <Package className="w-5 h-5" />;
      case 'setting': return <Settings className="w-5 h-5" />;
      default: return <History className="w-5 h-5" />;
    }
  }

  function getTypeColor(type: string) {
    switch (type) {
      case 'order': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'setting': return 'bg-green-100 text-green-800 border-green-300';
      case 'contact': return 'bg-amber-100 text-amber-800 border-amber-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-4 sm:p-6 lg:p-8 border-2 border-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center">
            <History className="w-6 h-6 sm:w-7 sm:h-7 mr-2 sm:mr-3 text-blue-600" />
            System Changelog
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1 sm:mt-2">
            Complete audit trail of all changes across orders, permissions, and settings
          </p>
        </div>
        <button
          onClick={fetchChangelog}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 sm:px-4 rounded-lg transition-colors text-sm sm:text-base whitespace-nowrap"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
          <span className="text-xs sm:text-sm font-medium text-slate-700">Filter:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({groupedOrders.length + entries.length})
          </button>
          <button
            onClick={() => setFilter('order')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              filter === 'order'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Orders ({groupedOrders.length})
          </button>
          <button
            onClick={() => setFilter('setting')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              filter === 'setting'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Settings ({entries.filter(e => e.type === 'setting').length})
          </button>
        </div>
        <div className="sm:ml-auto">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full sm:w-auto px-3 sm:px-4 py-1.5 sm:py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none text-xs sm:text-sm"
          >
            <option value={25}>Last 25</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={250}>Last 250</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {filteredGroupedOrders.length === 0 && filteredEntries.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 text-lg">No changelog entries found</p>
          </div>
        ) : (
          <>
            {/* Grouped Order Changes */}
            {filteredGroupedOrders.map((orderGroup) => (
              <div
                key={orderGroup.order_id}
                className="border-2 border-slate-200 rounded-lg sm:rounded-xl overflow-hidden hover:border-blue-300 transition-colors"
              >
                <div
                  className="p-3 sm:p-4 cursor-pointer bg-blue-50 hover:bg-blue-100 transition-colors"
                  onClick={() => toggleOrderExpansion(orderGroup.order_id)}
                >
                  <div className="flex items-start gap-2 sm:gap-4">
                    <div className="p-1.5 sm:p-2 rounded-lg bg-blue-100 text-blue-800 border-blue-300 flex-shrink-0">
                      <Package className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm sm:text-base break-words">
                            Order Updated - {orderGroup.customer_name}
                          </h3>
                          <p className="text-xs sm:text-sm text-slate-600">
                            {orderGroup.change_count} change{orderGroup.change_count > 1 ? 's' : ''} made to this order
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Order ID:{' '}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(orderGroup.order_id);
                                notify('Order ID copied! Switch to Orders tab to search for it');
                              }}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-mono"
                              title="Click to copy Order ID"
                            >
                              {formatOrderId(orderGroup.order_id)}...
                            </button>
                          </p>
                        </div>
                        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 flex-shrink-0">
                          <span className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs font-bold border-2 bg-blue-100 text-blue-800 border-blue-300 whitespace-nowrap">
                            ORDER
                          </span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            {new Date(orderGroup.latest_timestamp).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit'
                            })}
                          </span>
                          <button
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                          >
                            {expandedOrders.has(orderGroup.order_id) ? (
                              <>
                                <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                                <span className="hidden sm:inline">Hide changes</span>
                              </>
                            ) : (
                              <>
                                <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
                                <span className="hidden sm:inline">View changes</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {expandedOrders.has(orderGroup.order_id) && (
                  <div className="border-t-2 border-slate-200 bg-white">
                    <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                      {orderGroup.changes.map((change) => (
                        <div
                          key={change.id}
                          className="border border-slate-200 rounded-lg p-2 sm:p-3 bg-slate-50"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2 mb-2">
                            <div className="min-w-0">
                              <h4 className="font-medium text-slate-900 text-sm">{change.field_name}</h4>
                              <p className="text-xs text-slate-500">
                                {change.change_type} • {new Date(change.timestamp).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                            <span className="text-xs text-slate-600 whitespace-nowrap">
                              by {change.user_email}
                            </span>
                          </div>

                          {(change.old_value || change.new_value) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm mt-2">
                              {change.old_value && (
                                <div>
                                  <span className="font-medium text-slate-700 text-xs">Old Value:</span>
                                  <p className="text-slate-600 mt-1 break-words text-xs sm:text-sm">{change.old_value}</p>
                                </div>
                              )}
                              {change.new_value && (
                                <div>
                                  <span className="font-medium text-slate-700 text-xs">New Value:</span>
                                  <p className="text-slate-600 mt-1 break-words text-xs sm:text-sm">{change.new_value}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Other changelog entries (permissions, settings) */}
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="border-2 border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start gap-2 sm:gap-4">
                  <div className={`p-1.5 sm:p-2 rounded-lg ${getTypeColor(entry.type)} flex-shrink-0`}>
                    {getIcon(entry.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-2">
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 text-sm sm:text-base break-words">{entry.title}</h3>
                        <p className="text-xs sm:text-sm text-slate-600 break-words">{entry.description}</p>
                      </div>
                      <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 flex-shrink-0">
                        <span className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs font-bold border-2 ${getTypeColor(entry.type)} whitespace-nowrap`}>
                          {entry.type.toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>

                    {(entry.old_value || entry.new_value) && (
                      <div className="mt-2 sm:mt-3 p-2 sm:p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm">
                          {entry.old_value && (
                            <div>
                              <span className="font-medium text-slate-700 text-xs">Old Value:</span>
                              <p className="text-slate-600 mt-1 break-words text-xs sm:text-sm">{entry.old_value}</p>
                            </div>
                          )}
                          {entry.new_value && (
                            <div>
                              <span className="font-medium text-slate-700 text-xs">New Value:</span>
                              <p className="text-slate-600 mt-1 break-words text-xs sm:text-sm">{entry.new_value}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mt-2 text-xs text-slate-500">
                      Changed by: <span className="font-medium text-slate-700">{entry.user_email}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
