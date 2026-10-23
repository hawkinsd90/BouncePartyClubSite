import { useState, useEffect, useCallback, useRef, type ComponentProps } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, FileText } from 'lucide-react';
import { ORDER_STATUS } from '../lib/constants/statuses';
import { ContactsList } from '../components/admin/customers/ContactsList';
import { InvoicesList } from '../components/admin/invoices/InvoicesList';
import { OrdersManager } from '../components/admin/orders/OrdersManager';
import { InvoiceBuilder } from '../components/admin/invoices/InvoiceBuilder';
import { PendingOrderCard } from '../components/admin/orders/PendingOrderCard';
import { AdminCalendar } from '../components/AdminCalendar';
import { PermissionsTab } from '../components/admin/settings/PermissionsTab';
import { TravelCalculator } from '../components/admin/settings/TravelCalculator';
import { MessageTemplatesTab } from '../components/admin/settings/MessageTemplatesTab';
import { BlackoutTab } from '../components/admin/blackout/BlackoutTab';
import { ChangelogTab } from '../components/admin/settings/ChangelogTab';
import { BusinessBrandingTab } from '../components/admin/settings/BusinessBrandingTab';
import { AddressCoordinateBackfill } from '../components/admin/maintenance/AddressCoordinateBackfill';
import { InventorySection } from '../components/admin/catalog/InventorySection';
import { MenuGroupsTab } from '../components/admin/catalog/menu-groups/MenuGroupsTab';
import { PricingRulesSection } from '../components/admin/settings/PricingRulesSection';
import { PerformanceAnalytics } from '../components/admin/analytics/PerformanceAnalytics';
import { BusinessAnalytics } from '../components/admin/analytics/BusinessAnalytics';
import { SiteAnalytics } from '../components/admin/analytics/SiteAnalytics';
import { GoogleCalendarSettings } from '../components/admin/settings/GoogleCalendarSettings';
import { PhotosTab } from '../components/admin/content/PhotosTab';
import { NotificationFailuresAlert } from '../components/admin/settings/NotificationFailuresAlert';
import { AdminFloatingOrderHeader } from '../components/admin/orders/AdminFloatingOrderHeader';
import { TabNavigation, type AdminTab } from '../components/admin/TabNavigation';
import { PendingOrderCardRef } from '../components/admin/orders/PendingOrderCard';
import { useDataFetch } from '../hooks/core/useDataFetch';
import { handleError } from '../lib/core/errorHandling';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import type { Unit, PricingRules } from '../types';
import type { AdminOrderRecord } from '../lib/orders/adminOrderRecord';

interface UnitMedia {
  url: string;
  mode: string | null;
  sort: number | null;
  is_featured?: boolean;
}

interface UnitWithMedia extends Omit<Unit, 'description'> {
  unit_media?: UnitMedia[];
  image_url?: string | null;
  dimensions?: string | null;
  capacity?: number | null;
  description?: string | null;
}

interface AdminData {
  units: UnitWithMedia[];
  orders: AdminOrderRecord[];
  pricingRules: PricingRules | null;
}

function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabFromUrl || 'pending');
  const [visibleOrder, setVisibleOrder] = useState<AdminOrderRecord | null>(null);
  const orderCardsRef = useRef<Map<string, PendingOrderCardRef>>(new Map());

  // Set URL parameter on initial load if not present
  useEffect(() => {
    if (!tabFromUrl) {
      setSearchParams({ tab: 'pending' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  const fetchAdminData = useCallback(async () => {
    const orderSelect = `
        *,
        customers (first_name, last_name, email, phone),
        addresses (line1, city, state, zip, lat, lng),
        order_changelog (change_type, notes, created_at)
      `;
    const [unitsRes, pendingRes, otherRes, pricingRes] = await Promise.all([
      supabase.from('units').select(`
        *,
        unit_media (
          url,
          mode,
          sort
        )
      `).order('name'),
      // Pending review has its own query: it must never be pushed out of a shared 50-row window by newer confirmed or draft orders.
      supabase.from('orders').select(orderSelect).eq('status', ORDER_STATUS.PENDING).eq('order_changelog.change_type', 'travel_city_review').order('created_at', { ascending: false }).limit(200),
      supabase.from('orders').select(orderSelect).in('status', [ORDER_STATUS.DRAFT, ORDER_STATUS.CONFIRMED]).eq('order_changelog.change_type', 'travel_city_review').order('created_at', { ascending: false }).limit(50),
      supabase.from('pricing_rules').select('*').limit(1).maybeSingle(),
    ]);

    if (unitsRes.error) throw unitsRes.error;
    if (pendingRes.error) throw pendingRes.error;
    if (otherRes.error) throw otherRes.error;
    if (pricingRes.error) throw pricingRes.error;

    // Process units to add image_url from unit_media
    const unitsWithImages = (unitsRes.data || []).map(unit => {
      const unitMedia = Array.isArray(unit.unit_media) ? unit.unit_media : [];

      // Find featured image across ALL images (dry or wet)
      const featuredImage = unitMedia.find((media: UnitMedia) => media.is_featured);

      // If no featured image, fall back to first dry image sorted by sort order
      const dryImages = unitMedia
        .filter((media: UnitMedia) => media.mode === 'dry')
        .sort((a: UnitMedia, b: UnitMedia) => (a.sort ?? 0) - (b.sort ?? 0));

      const imageUrl = featuredImage?.url || (dryImages.length > 0 ? dryImages[0].url : null);

      return {
        ...unit,
        unit_media: unitMedia,
        image_url: imageUrl
      };
    });

    return {
      units: (unitsWithImages || []) as UnitWithMedia[],
      orders: [...(pendingRes.data || []), ...(otherRes.data || [])] as unknown as AdminOrderRecord[],
      pricingRules: pricingRes.data as unknown as PricingRules,
    };
  }, []);

  const handleDataError = useCallback((error: Error | unknown) => {
    handleError(error, 'Admin.loadData');
  }, []);

  const { data, loading, error: loadError, refetch } = useDataFetch<AdminData>(
    fetchAdminData,
    {
      errorMessage: 'Failed to load admin data',
      onError: handleDataError,
      // Refreshing after a save must not replace the page with a spinner (it would close the open editor).
      keepDataWhileRefetching: true,
    }
  );

  const units = data?.units || [];
  const orders = data?.orders || [];
  const pricingRules = data?.pricingRules;

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- URL to state sync only when the URL tab changes; listing activeTab would undo tab clicks
  }, [tabFromUrl]);

  function handleEditFromFloatingHeader() {
    if (!visibleOrder) return;

    const orderRef = orderCardsRef.current.get(visibleOrder.id);
    if (orderRef?.openEdit) {
      orderRef.openEdit();
    }
  }

  // Keep a ref to the latest pending orders so the scroll handler always reads
  // the current list without being a dependency that would recreate the listener.
  const pendingOrdersRef = useRef<typeof orders>([]);
  const pendingOrders = orders.filter(o => o.status === ORDER_STATUS.PENDING);
  pendingOrdersRef.current = pendingOrders;

  // Stable ref to computeVisibleOrder so it can be called both from the scroll
  // handler and from the orders-change effect without recreating the listener.
  const computeVisibleOrderRef = useRef<() => void>(() => {});

  // Scroll detection for floating header
  useEffect(() => {
    if (activeTab !== 'pending') {
      setVisibleOrder(null);
      return;
    }

    let rafId: number | null = null;

    function computeVisibleOrder() {
      let bestMatch = null;
      let closestDistance = Infinity;

      orderCardsRef.current.forEach((refs, orderId) => {
        const { card, actionButtons } = refs;
        const cardRect = card.getBoundingClientRect();

        const triggerElement = actionButtons || card;
        const triggerRect = triggerElement.getBoundingClientRect();

        const hasScrolledPastTop = cardRect.top < 64;
        const actionButtonsVisible = triggerRect.bottom > 64;

        if (hasScrolledPastTop && actionButtonsVisible) {
          const distanceFromTop = Math.abs(cardRect.top - 64);

          if (distanceFromTop < closestDistance) {
            closestDistance = distanceFromTop;
            const order = pendingOrdersRef.current.find(o => o.id === orderId);
            if (order) {
              bestMatch = order;
            }
          }
        }
      });

      setVisibleOrder(bestMatch);
    }

    // Expose so the orders-update effect can re-run it without scroll
    computeVisibleOrderRef.current = computeVisibleOrder;

    function handleScroll() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeVisibleOrder();
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    computeVisibleOrder();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeTab]);

  // Stable signature of pending-review IDs in render order — only changes when
  // the set of pending_review orders materially changes, not on every refetch.
  // Reuses the already-filtered array above to avoid a duplicate pass.
  const pendingReviewSignature = pendingOrders.map(o => o.id).join(',');

  // Re-run computeVisibleOrder whenever the pending orders list changes so the
  // floating header updates immediately after a data refresh without requiring scroll.
  useEffect(() => {
    if (activeTab === 'pending') {
      computeVisibleOrderRef.current();
    }
  }, [pendingReviewSignature, activeTab]);

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

  // The first load failed: say so with a Retry. (Without this the tabs below render empty, which reads as "no pending bookings".)
  if (loadError && !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-amber-200 text-center" role="alert">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">The admin data could not be loaded</h2>
          <p className="text-slate-600 mb-6">Nothing has been changed. Check your connection and try again.</p>
          <button onClick={refetch} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold min-h-[48px]">Try again</button>
        </div>
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
        pendingCount={orders.filter(o => o.status === ORDER_STATUS.PENDING).length}
      />

      <NotificationFailuresAlert />

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 hover:shadow-2xl transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <Package className="w-8 h-8 text-blue-600" />
                <span className="text-3xl font-bold text-slate-900">{units.length}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Active Units</h3>
              <p className="text-sm text-slate-600">Inventory items available to book</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 hover:shadow-2xl transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <FileText className="w-8 h-8 text-green-600" />
                <span className="text-3xl font-bold text-slate-900">{orders.length}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Recent Orders</h3>
              <p className="text-sm text-slate-600">Most recent loaded orders — see Analytics tab for all-time totals</p>
            </div>
          </div>

          <PerformanceAnalytics />
        </div>
      )}

      {activeTab === 'pending' && (
        <>
          <AdminFloatingOrderHeader
            order={visibleOrder}
            isVisible={!!visibleOrder}
            onEditClick={handleEditFromFloatingHeader}
          />

          <div className={`bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100 ${visibleOrder ? 'pt-[calc(var(--site-header-height)_+_1rem)]' : ''}`}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Pending Review</h2>
              <button
                onClick={refetch}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl"
              >
                Refresh
              </button>
            </div>

            {orders.filter(o => o.status === ORDER_STATUS.PENDING).length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-600 mb-2">No pending bookings</p>
                <p className="text-sm text-slate-500">New bookings will appear here for review</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter(o => o.status === ORDER_STATUS.PENDING)
                  .map((order) => (
                    <PendingOrderCard
                      key={order.id}
                      order={order}
                      onUpdate={refetch}
                      ref={(refs: PendingOrderCardRef | null) => {
                        if (refs) {
                          orderCardsRef.current.set(order.id, refs);
                        } else {
                          orderCardsRef.current.delete(order.id);
                        }
                      }}
                    />
                  ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'calendar' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <AdminCalendar />
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <BusinessAnalytics />
        </div>
      )}

      {activeTab === 'site_activity' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <SiteAnalytics />
        </div>
      )}

      {activeTab === 'google_calendar' && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-slate-100">
          <GoogleCalendarSettings />
        </div>
      )}

      {activeTab === 'inventory' && <InventorySection units={units as unknown as ComponentProps<typeof InventorySection>['units']} onRefetch={refetch} />}

      {activeTab === 'menu_groups' && <MenuGroupsTab />}

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

      {activeTab === 'pricing' && pricingRules && <PricingRulesSection pricingRules={pricingRules as unknown as ComponentProps<typeof PricingRulesSection>['pricingRules']} />}
      {activeTab === 'pricing' && !pricingRules && (
        <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-amber-200 text-center" role="alert">
          <p className="text-slate-700 mb-4">The pricing rules could not be loaded, so they are not shown here.</p>
          <button onClick={refetch} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold min-h-[48px]">Try again</button>
        </div>
      )}

      {activeTab === 'branding' && <BusinessBrandingTab />}

      {activeTab === 'tools' && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Admin Tools</h2>
          <AddressCoordinateBackfill />
        </div>
      )}

      {activeTab === 'photos' && <PhotosTab />}

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
