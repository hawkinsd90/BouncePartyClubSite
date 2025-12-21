import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Package, DollarSign, FileText, Download } from 'lucide-react';
import { ContactsList } from '../components/admin/ContactsList';
import { InvoicesList } from '../components/admin/InvoicesList';
import { OrdersManager } from '../components/admin/OrdersManager';
import { InvoiceBuilder } from '../components/admin/InvoiceBuilder';
import { PendingOrderCard } from '../components/admin/PendingOrderCard';
import { AdminCalendar } from '../components/AdminCalendar';
import { PermissionsTab } from '../components/admin/PermissionsTab';
import { TravelCalculator } from '../components/admin/TravelCalculator';
import { MessageTemplatesTab } from '../components/admin/MessageTemplatesTab';
import { InventorySection } from '../components/admin/InventorySection';
import { PricingSection } from '../components/admin/PricingSection';
import { TabNavigation, type AdminTab } from '../components/admin/TabNavigation';
import { notify } from '../lib/notifications';
import { useDataFetch } from '../hooks/useDataFetch';
import { handleError } from '../lib/errorHandling';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

interface AdminData {
  units: any[];
  orders: any[];
  pricingRules: any | null;
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabFromUrl || 'pending');

  const fetchAdminData = useCallback(async () => {
    const [unitsRes, ordersRes, pricingRes] = await Promise.all([
      supabase.from('units').select('*').order('name'),
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

    return {
      units: unitsRes.data || [],
      orders: ordersRes.data || [],
      pricingRules: pricingRes.data,
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
    if (units.length === 0) {
      notify('No units available to export', 'error');
      return;
    }

    const formatCurrency = (cents: number) => {
      return `$${(cents / 100).toFixed(2)}`;
    };

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Bounce Party Club - Rental Catalog</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              background: white;
            }
            .header {
              text-align: center;
              margin-bottom: 40px;
              border-bottom: 4px solid #2563eb;
              padding-bottom: 20px;
            }
            .header h1 {
              font-size: 36px;
              color: #1e293b;
              margin-bottom: 10px;
            }
            .header p {
              font-size: 18px;
              color: #64748b;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 30px;
              page-break-inside: avoid;
            }
            .unit-card {
              border: 2px solid #e2e8f0;
              border-radius: 12px;
              padding: 20px;
              page-break-inside: avoid;
            }
            .unit-card h2 {
              font-size: 24px;
              color: #1e293b;
              margin-bottom: 15px;
              border-bottom: 2px solid #2563eb;
              padding-bottom: 10px;
            }
            .unit-type {
              background: #dbeafe;
              color: #1e40af;
              padding: 6px 12px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: bold;
              display: inline-block;
              margin-bottom: 15px;
            }
            .combo-badge {
              background: #fef3c7;
              color: #92400e;
              padding: 6px 12px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: bold;
              display: inline-block;
              margin-left: 8px;
            }
            .details {
              margin: 15px 0;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px solid #f1f5f9;
            }
            .detail-label {
              font-weight: bold;
              color: #64748b;
            }
            .detail-value {
              color: #1e293b;
            }
            .pricing {
              background: #f0fdf4;
              border: 2px solid #86efac;
              border-radius: 8px;
              padding: 15px;
              margin-top: 15px;
            }
            .pricing-row {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
            }
            .pricing-label {
              font-weight: bold;
              color: #166534;
            }
            .pricing-value {
              font-size: 20px;
              font-weight: bold;
              color: #15803d;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              padding-top: 20px;
              border-top: 2px solid #e2e8f0;
              color: #64748b;
              font-size: 14px;
            }
            @media print {
              body { padding: 20px; }
              .grid { gap: 20px; }
              .unit-card { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🎉 Bounce Party Club</h1>
            <p>Inflatable Rental Catalog - ${new Date().toLocaleDateString()}</p>
          </div>

          <div class="grid">
            ${units.map(unit => `
              <div class="unit-card">
                <h2>${unit.name}</h2>
                <div>
                  <span class="unit-type">${unit.type}</span>
                  ${unit.is_combo ? '<span class="combo-badge">COMBO</span>' : ''}
                </div>

                <div class="details">
                  <div class="detail-row">
                    <span class="detail-label">Dimensions:</span>
                    <span class="detail-value">${unit.dimensions || 'N/A'}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Footprint:</span>
                    <span class="detail-value">${unit.footprint_sqft} sq ft</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Capacity:</span>
                    <span class="detail-value">${unit.capacity} people</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Power Required:</span>
                    <span class="detail-value">${unit.power_circuits} circuit${unit.power_circuits !== 1 ? 's' : ''}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Indoor Use:</span>
                    <span class="detail-value">${unit.indoor_ok ? 'Yes' : 'No'}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Outdoor Use:</span>
                    <span class="detail-value">${unit.outdoor_ok ? 'Yes' : 'No'}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Quantity Available:</span>
                    <span class="detail-value">${unit.quantity_available}</span>
                  </div>
                </div>

                <div class="pricing">
                  <div class="pricing-row">
                    <span class="pricing-label">Dry Mode:</span>
                    <span class="pricing-value">${formatCurrency(unit.price_dry_cents)}</span>
                  </div>
                  ${unit.price_water_cents ? `
                    <div class="pricing-row">
                      <span class="pricing-label">Water Mode:</span>
                      <span class="pricing-value">${formatCurrency(unit.price_water_cents)}</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="footer">
            <p><strong>Bounce Party Club</strong> | Contact us for bookings and more information</p>
            <p style="margin-top: 8px;">Prices shown are base rental rates. Additional fees may apply for delivery, setup, and special requirements.</p>
          </div>

          <script>
            // Auto-open print dialog when page loads
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    } else {
      notify('Unable to open print window. Please allow popups for this site.', 'error');
    }
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
        <h1 className="text-5xl font-bold text-slate-900 tracking-tight">Admin Dashboard</h1>
        <button
          onClick={handleExportMenu}
          className="flex items-center bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl"
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

      {activeTab === 'pricing' && pricingRules && <PricingSection pricingRules={pricingRules} />}

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
