import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Package, DollarSign, FileText, Download } from 'lucide-react';
import { ContactsList } from '../components/ContactsList';
import { InvoicesList } from '../components/InvoicesList';
import { OrdersManager } from '../components/OrdersManager';
import { InvoiceBuilder } from '../components/InvoiceBuilder';
import { PendingOrderCard } from '../components/PendingOrderCard';
import { AdminCalendar } from '../components/AdminCalendar';
import { AdminSettings } from '../components/admin/AdminSettings';
import { AdminSMSTemplates } from '../components/admin/AdminSMSTemplates';
import { InventorySection } from '../components/admin/InventorySection';
import { PricingSection } from '../components/admin/PricingSection';
import { TabNavigation, type AdminTab } from '../components/admin/TabNavigation';
import { notify } from '../lib/notifications';
import { useDataFetch } from '../hooks/useDataFetch';
import { handleError } from '../lib/errorHandling';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface AdminData {
  units: any[];
  orders: any[];
  pricingRules: any | null;
  twilioSettings: { account_sid: string; auth_token: string; from_number: string };
  stripeSettings: { secret_key: string; publishable_key: string };
  adminEmail: string;
  smsTemplates: any[];
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabFromUrl || 'pending');

  const fetchAdminData = useCallback(async () => {
    const [unitsRes, ordersRes, pricingRes, settingsRes, templatesRes] = await Promise.all([
      supabase.from('units').select('*').order('name'),
      supabase.from('orders').select(`
        *,
        customers (first_name, last_name, email, phone),
        addresses (line1, city, state, zip)
      `).in('status', ['pending_review', 'draft', 'confirmed']).order('created_at', { ascending: false }).limit(50),
      supabase.from('pricing_rules').select('*').limit(1).maybeSingle(),
      supabase.from('admin_settings').select('*').in('key', ['twilio_account_sid', 'twilio_auth_token', 'twilio_from_number', 'admin_email', 'stripe_secret_key', 'stripe_publishable_key']),
      supabase.from('sms_message_templates').select('*').order('template_name'),
    ]);

    if (unitsRes.error) throw unitsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (pricingRes.error) throw pricingRes.error;
    if (settingsRes.error) throw settingsRes.error;
    if (templatesRes.error) throw templatesRes.error;

    const settings: any = {};
    const stripeSet: any = {};
    let email = '';

    settingsRes.data?.forEach((s: any) => {
      if (s.key === 'twilio_account_sid') settings.account_sid = s.value;
      if (s.key === 'twilio_auth_token') settings.auth_token = s.value;
      if (s.key === 'twilio_from_number') settings.from_number = s.value;
      if (s.key === 'admin_email') email = s.value;
      if (s.key === 'stripe_secret_key') stripeSet.secret_key = s.value;
      if (s.key === 'stripe_publishable_key') stripeSet.publishable_key = s.value;
    });

    return {
      units: unitsRes.data || [],
      orders: ordersRes.data || [],
      pricingRules: pricingRes.data,
      twilioSettings: settings,
      stripeSettings: stripeSet,
      adminEmail: email,
      smsTemplates: templatesRes.data || [],
    };
  }, []);

  const handleDataError = useCallback((error: any) => {
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
  const smsTemplates = data?.smsTemplates || [];

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  function changeTab(tab: AdminTab) {
    setActiveTab(tab);
    setSearchParams({ tab });
  }

  const handleExportMenu = () => {
    notify('Menu export feature coming soon - will generate PNG/PDF with current pricing');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold text-slate-900">Admin Dashboard</h1>
        <button
          onClick={handleExportMenu}
          className="flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          <Download className="w-5 h-5 mr-2" />
          Export Menu
        </button>
      </div>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={changeTab}
        pendingCount={orders.filter(o => o.status === 'pending_review').length}
      />

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Package className="w-8 h-8 text-blue-600" />
              <span className="text-3xl font-bold text-slate-900">{units.length}</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Total Units</h3>
            <p className="text-sm text-slate-600">Active inventory items</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="w-8 h-8 text-green-600" />
              <span className="text-3xl font-bold text-slate-900">{orders.length}</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Recent Orders</h3>
            <p className="text-sm text-slate-600">Last 20 bookings</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
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
      )}

      {activeTab === 'pending' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Pending Review</h2>
            <button
              onClick={refetch}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
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
        <div className="bg-white rounded-xl shadow-md p-6">
          <AdminCalendar />
        </div>
      )}

      {activeTab === 'inventory' && <InventorySection units={units} onRefetch={refetch} />}

      {activeTab === 'orders' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <OrdersManager />
        </div>
      )}

      {activeTab === 'changelog' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Admin Settings Changelog</h2>
          <p className="text-slate-600 mb-4">
            View all changes made to admin settings, including who made the changes and when.
          </p>
          <div className="text-center py-12 text-slate-500">
            <p>Changelog feature coming soon...</p>
            <p className="text-sm mt-2">Will display all admin setting changes with timestamps and user tracking</p>
          </div>
        </div>
      )}

      {activeTab === 'calculator' && (
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Travel Fee Calculator</h2>
          <p className="text-slate-600 mb-4">
            Calculate travel fees for phone estimates by entering a customer address.
          </p>
          <div className="text-center py-12 text-slate-500">
            <p>Travel fee calculator coming soon...</p>
            <p className="text-sm mt-2">Will show distance calculation and fee breakdown</p>
          </div>
        </div>
      )}

      {activeTab === 'pricing' && pricingRules && <PricingSection pricingRules={pricingRules} />}

      {activeTab === 'contacts' && <ContactsList />}

      {activeTab === 'invoices' && (
        <div className="space-y-8">
          <InvoiceBuilder />
          <InvoicesList />
        </div>
      )}

      {activeTab === 'settings' && data && (
        <AdminSettings
          initialTwilioSettings={data.twilioSettings}
          initialStripeSettings={data.stripeSettings}
          initialAdminEmail={data.adminEmail}
        />
      )}

      {activeTab === 'sms_templates' && <AdminSMSTemplates templates={smsTemplates} onRefetch={refetch} />}
    </div>
  );
}

export function Admin() {
  return <AdminDashboard />;
}
