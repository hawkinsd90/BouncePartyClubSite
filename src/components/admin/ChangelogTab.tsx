import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { History, Package, Shield, Settings, Filter, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { notify } from '../../lib/notifications';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface OrderChange {
  id: string;
  order_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  created_at: string;
  user_id: string | null;
}

interface GroupedOrderChange {
  order_id: string;
  customer_name: string;
  change_count: number;
  latest_timestamp: string;
  latest_user_email: string;
  changes: Array<{
    id: string;
    field_changed: string;
    old_value: string | null;
    new_value: string | null;
    change_type: string;
    timestamp: string;
    user_email: string;
  }>;
}

interface ChangelogEntry {
  id: string;
  type: 'order' | 'permission' | 'setting' | 'contact';
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
  const [filter, setFilter] = useState<'all' | 'order' | 'permission' | 'setting' | 'contact'>('all');
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

      // Fetch permission changes
      const { data: permChanges, error: permError } = await supabase
        .from('user_permissions_changelog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (permError) throw permError;

      // Fetch admin settings changes
      const { data: settingChanges, error: settingError } = await supabase
        .from('admin_settings_changelog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (settingError) throw settingError;

      // Collect all unique user IDs
      const userIds = new Set<string>();
      (orderChanges || []).forEach(change => {
        if (change.user_id) userIds.add(change.user_id);
      });
      (permChanges || []).forEach(change => {
        if (change.changed_by_user_id) userIds.add(change.changed_by_user_id);
        if (change.target_user_id) userIds.add(change.target_user_id);
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
        const latestUserEmail = latestChange.user_id
          ? userInfo[latestChange.user_id]?.email || 'Unknown User'
          : 'System';

        grouped.push({
          order_id,
          customer_name: customerName,
          change_count: group.changes.length,
          latest_timestamp: latestChange.created_at,
          latest_user_email: latestUserEmail,
          changes: group.changes.map(change => ({
            id: change.id,
            field_changed: change.field_changed || 'Order modified',
            old_value: change.old_value,
            new_value: change.new_value,
            change_type: change.change_type,
            timestamp: change.created_at,
            user_email: change.user_id
              ? userInfo[change.user_id]?.email || 'Unknown User'
              : 'System'
          }))
        });
      }

      setGroupedOrders(grouped);

      // Process permission changes
      for (const change of permChanges || []) {
        const changedByEmail = change.changed_by_user_id
          ? userInfo[change.changed_by_user_id]?.email || 'Unknown User'
          : 'System';

        const targetEmail = change.target_user_id
          ? userInfo[change.target_user_id]?.email || 'Unknown User'
          : 'Unknown User';

        allEntries.push({
          id: change.id,
          type: 'permission',
          timestamp: change.created_at,
          user_email: changedByEmail,
          title: `Permission ${change.action} - ${targetEmail}`,
          description: change.old_role && change.new_role
            ? `Changed from ${change.old_role} to ${change.new_role}`
            : change.new_role
            ? `Set to ${change.new_role}`
            : `Removed ${change.old_role}`,
          old_value: change.old_role,
          new_value: change.new_role,
          details: { action: change.action, notes: change.notes }
        });
      }

      // Process admin settings changes
      for (const change of settingChanges || []) {
        const userEmail = change.changed_by
          ? userInfo[change.changed_by]?.email || 'Unknown User'
          : 'System';

        allEntries.push({
          id: change.id,
          type: 'setting',
          timestamp: change.created_at,
          user_email: userEmail,
          title: `Setting Changed: ${change.setting_key}`,
          description: change.change_description || 'Setting updated',
          old_value: change.old_value,
          new_value: change.new_value,
          details: { setting_key: change.setting_key }
        });
      }

      // Sort all entries by timestamp
      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setEntries(allEntries);
    } catch (error: any) {
      notify(error.message, 'error');
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
      case 'permission': return <Shield className="w-5 h-5" />;
      case 'setting': return <Settings className="w-5 h-5" />;
      default: return <History className="w-5 h-5" />;
    }
  }

  function getTypeColor(type: string) {
    switch (type) {
      case 'order': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'permission': return 'bg-purple-100 text-purple-800 border-purple-300';
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
    <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center">
            <History className="w-7 h-7 mr-3 text-blue-600" />
            System Changelog
          </h2>
          <p className="text-slate-600 mt-2">
            Complete audit trail of all changes across orders, permissions, and settings
          </p>
        </div>
        <button
          onClick={fetchChangelog}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-slate-600" />
          <span className="text-sm font-medium text-slate-700">Filter:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({groupedOrders.length + entries.length})
          </button>
          <button
            onClick={() => setFilter('order')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'order'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Orders ({groupedOrders.length})
          </button>
          <button
            onClick={() => setFilter('permission')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'permission'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Permissions ({entries.filter(e => e.type === 'permission').length})
          </button>
          <button
            onClick={() => setFilter('setting')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'setting'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Settings ({entries.filter(e => e.type === 'setting').length})
          </button>
        </div>
        <div className="ml-auto">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
                className="border-2 border-slate-200 rounded-xl overflow-hidden hover:border-blue-300 transition-colors"
              >
                <div
                  className="p-4 cursor-pointer bg-blue-50 hover:bg-blue-100 transition-colors"
                  onClick={() => toggleOrderExpansion(orderGroup.order_id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-blue-100 text-blue-800 border-blue-300">
                      <Package className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-slate-900 flex items-center gap-2">
                            <span>Order Updated - {orderGroup.customer_name}</span>
                            <a
                              href={`#order-${orderGroup.order_id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                notify('Click on the order ID in the Orders tab to view full details', 'info');
                              }}
                              className="text-blue-600 hover:text-blue-800"
                              title="View order details"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </h3>
                          <p className="text-sm text-slate-600">
                            {orderGroup.change_count} change{orderGroup.change_count > 1 ? 's' : ''} made to this order
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Order ID: {orderGroup.order_id.substring(0, 8)}...
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="px-3 py-1 rounded-full text-xs font-bold border-2 bg-blue-100 text-blue-800 border-blue-300">
                            ORDER
                          </span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            {new Date(orderGroup.latest_timestamp).toLocaleString()}
                          </span>
                          <button
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1"
                          >
                            {expandedOrders.has(orderGroup.order_id) ? (
                              <>
                                <ChevronDown className="w-4 h-4" />
                                Hide changes
                              </>
                            ) : (
                              <>
                                <ChevronRight className="w-4 h-4" />
                                View changes
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
                    <div className="p-4 space-y-3">
                      {orderGroup.changes.map((change) => (
                        <div
                          key={change.id}
                          className="border border-slate-200 rounded-lg p-3 bg-slate-50"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h4 className="font-medium text-slate-900">{change.field_changed}</h4>
                              <p className="text-xs text-slate-500">
                                {change.change_type} • {new Date(change.timestamp).toLocaleString()}
                              </p>
                            </div>
                            <span className="text-xs text-slate-600">
                              by {change.user_email}
                            </span>
                          </div>

                          {(change.old_value || change.new_value) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mt-2">
                              {change.old_value && (
                                <div>
                                  <span className="font-medium text-slate-700 text-xs">Old Value:</span>
                                  <p className="text-slate-600 mt-1 break-words">{change.old_value}</p>
                                </div>
                              )}
                              {change.new_value && (
                                <div>
                                  <span className="font-medium text-slate-700 text-xs">New Value:</span>
                                  <p className="text-slate-600 mt-1 break-words">{change.new_value}</p>
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
                className="border-2 border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${getTypeColor(entry.type)}`}>
                    {getIcon(entry.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <h3 className="font-bold text-slate-900">{entry.title}</h3>
                        <p className="text-sm text-slate-600">{entry.description}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${getTypeColor(entry.type)}`}>
                          {entry.type.toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {(entry.old_value || entry.new_value) && (
                      <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          {entry.old_value && (
                            <div>
                              <span className="font-medium text-slate-700">Old Value:</span>
                              <p className="text-slate-600 mt-1 break-words">{entry.old_value}</p>
                            </div>
                          )}
                          {entry.new_value && (
                            <div>
                              <span className="font-medium text-slate-700">New Value:</span>
                              <p className="text-slate-600 mt-1 break-words">{entry.new_value}</p>
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
