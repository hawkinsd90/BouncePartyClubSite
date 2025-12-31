import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Package, DollarSign, FileText } from 'lucide-react';
import { ContactsList } from '../components/admin/ContactsList';
import { InvoicesList } from '../components/admin/InvoicesList';
import { OrdersManager } from '../components/admin/OrdersManager';
import { InvoiceBuilder } from '../components/admin/InvoiceBuilder';
import { PendingOrderCard } from '../components/admin/PendingOrderCard';
import { AdminCalendar } from '../components/AdminCalendar';
import { PermissionsTab } from '../components/admin/PermissionsTab';
import { TravelCalculator } from '../components/admin/TravelCalculator';
import { MessageTemplatesTab } from '../components/admin/MessageTemplatesTab';
import { BlackoutTab } from '../components/admin/BlackoutTab';
import { ChangelogTab } from '../components/admin/ChangelogTab';
import { BusinessBrandingTab } from '../components/admin/BusinessBrandingTab';
import { InventorySection } from '../components/admin/InventorySection';
import { PricingSection } from '../components/admin/PricingSection';
import { PerformanceAnalytics } from '../components/admin/PerformanceAnalytics';
import { NotificationFailuresAlert } from '../components/admin/NotificationFailuresAlert';
import { TabNavigation, type AdminTab } from '../components/admin/TabNavigation';
import { useDataFetch } from '../hooks/useDataFetch';
import { handleError } from '../lib/errorHandling';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import type { Unit, PricingRules } from '../types';

interface UnitMedia {
  url: string;
  mode: 'dry' | 'water';
  sort: number;
}

interface UnitWithMedia extends Unit {
  unit_media?: UnitMedia[];
  image_url?: string | null;
  dimensions?: string | null;
  capacity?: string | null;
}

interface Customer {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

interface OrderAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

interface OrderWithRelations {
  id: string;
  order_number?: string;
  status: string;
  event_date: string;
  event_end_date?: string;
  subtotal_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  created_at: string;
  customers: Customer | null;
  addresses: OrderAddress | null;
}

interface AdminData {
  units: UnitWithMedia[];
  orders: OrderWithRelations[];
  pricingRules: PricingRules | null;
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabFromUrl || 'pending');

  const fetchAdminData = useCallback(async () => {
    const [unitsRes, ordersRes, pricingRes] = await Promise.all([
      supabase.from('units').select(`
        *,
        unit_media (
          url,
          mode,
          sort
        )
      `).order('name'),
      supabase.from('orders').select(`
        *,
        customers (first_name, last_name, email, phone),
        addresses (line1, city, state, zip)
      `).in('status', ['pending_review', 'draft', 'confirmed']).order('created_at', { ascending: false }).limit(50),
      supabase.from('pricing_rules').select('*').limit(1).maybeSingle(),
    ]);

    if (unitsRes.error) throw unitsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (pricingRes.error) throw pricingRes.error;

    // Process units to add image_url from unit_media
    const unitsWithImages = (unitsRes.data || []).map(unit => {
      const dryImages = (unit.unit_media || [])
        .filter((media: UnitMedia) => media.mode === 'dry')
        .sort((a: UnitMedia, b: UnitMedia) => a.sort - b.sort);
      return {
        ...unit,
        image_url: dryImages.length > 0 ? dryImages[0].url : null
      };
    });

    return {
      units: unitsWithImages || [],
      orders: ordersRes.data || [],
      pricingRules: pricingRes.data,
    };
  }, []);

  const handleDataError = useCallback((error: Error | unknown) => {
    handleError(error, 'Admin.loadData');
  }, []);

  const { data, loading, refetch } = useDataFetch<AdminData>(
    fetchAdminData,
    {
      errorMessage: 'Failed to load admin data',
      onError: handleDataError,
    }
  );

  const units = data?.units || [];
  const orders = data?.orders || [];
  const pricingRules = data?.pricingRules;

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  function changeTab(tab: AdminTab) {
    setActiveTab(tab);
    setSearchParams({ tab });
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-5xl font-bold text-slate-900 tracking-tight">Admin Dashboard</h1>
      </div>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={changeTab}
        pendingCount={orders.filter(o => o.status === 'pending_review').length}
      />

      <NotificationFailuresAlert />

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 hover:shadow-2xl transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <Package className="w-8 h-8 text-blue-600" />
                <span className="text-3xl font-bold text-slate-900">{units.length}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Total Units</h3>
              <p className="text-sm text-slate-600">Active inventory items</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 hover:shadow-2xl transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <FileText className="w-8 h-8 text-green-600" />
                <span className="text-3xl font-bold text-slate-900">{orders.length}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Recent Orders</h3>
              <p className="text-sm text-slate-600">Last 20 bookings</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 hover:shadow-2xl transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <DollarSign className="w-8 h-8 text-cyan-600" />
                <span className="text-3xl font-bold text-slate-900">
                  {formatCurrency(
                    orders
                      .filter((o) => o.status === 'confirmed')
                      .reduce((sum, o) => sum + o.subtotal_cents, 0)
                  )}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Total Revenue</h3>
              <p className="text-sm text-slate-600">Confirmed bookings</p>
            </div>
          </div>

          <PerformanceAnalytics />
        </div>
      )}

      {activeTab === 'pending' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Pending Review</h2>
            <button
              onClick={refetch}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl"
            >
              Refresh
            </button>
          </div>

          {orders.filter(o => o.status === 'pending_review').length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-600 mb-2">No pending bookings</p>
              <p className="text-sm text-slate-500">New bookings will appear here for review</p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders
                .filter(o => o.status === 'pending_review')
                .map((order) => (
                  <PendingOrderCard key={order.id} order={order} onUpdate={refetch} />
                ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <AdminCalendar />
        </div>
      )}

      {activeTab === 'inventory' && <InventorySection units={units} onRefetch={refetch} />}

      {activeTab === 'orders' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <OrdersManager />
        </div>
      )}

      {activeTab === 'calculator' && <TravelCalculator />}

      {activeTab === 'permissions' && <PermissionsTab />}

      {activeTab === 'message_templates' && <MessageTemplatesTab />}

      {activeTab === 'blackout' && <BlackoutTab />}

      {activeTab === 'changelog' && <ChangelogTab />}

      {activeTab === 'pricing' && pricingRules && <PricingSection pricingRules={pricingRules as any} />}

      {activeTab === 'branding' && <BusinessBrandingTab />}

      {activeTab === 'contacts' && <ContactsList />}

      {activeTab === 'invoices' && (
        <div className="space-y-8">
          <InvoiceBuilder />
          <InvoicesList />
        </div>
      )}
    </div>
  );
}

export function Admin() {
  return <AdminDashboard />;
}
