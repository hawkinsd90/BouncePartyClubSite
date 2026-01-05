import { useState, useEffect, useCallback } from 'react';
import { X, Truck, MessageSquare, FileText, History, Save, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { checkMultipleUnitsAvailability } from '../../lib/availability';
import { formatOrderSummary, type OrderSummaryData } from '../../lib/orderSummary';
import { calculateDrivingDistance } from '../../lib/pricing';
import { HOME_BASE } from '../../lib/constants';
import { StatusChangeDialog } from '../order-detail/StatusChangeDialog';
import { OrderNotesTab } from '../order-detail/OrderNotesTab';
import { OrderWorkflowTab } from '../order-detail/OrderWorkflowTab';
import { OrderChangelogTab } from '../order-detail/OrderChangelogTab';
import { OrderDetailsTab } from '../order-detail/OrderDetailsTab';
import { PaymentsTab } from '../order-detail/PaymentsTab';
import { useOrderPricing } from '../../hooks/useOrderPricing';
import { useOrderDetails } from '../../hooks/useOrderDetails';
import { saveOrderChanges } from '../../lib/orderSaveService';
import { sendOrderEditNotifications } from '../../lib/orderNotificationService';

interface OrderDetailModalProps {
  order: any;
  onClose: () => void;
  onUpdate: () => void;
}

interface StagedItem {
  id?: string; // undefined for new items
  unit_id: string;
  unit_name: string;
  qty: number;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  is_new?: boolean;
  is_deleted?: boolean;
}

export function OrderDetailModal({ order, onClose, onUpdate }: OrderDetailModalProps) {
  const [activeSection, setActiveSection] = useState<'details' | 'workflow' | 'notes' | 'changelog' | 'payments'>('details');
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<any[]>([]);
  const [changelog, setChangelog] = useState<any[]>([]);
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [editedOrder, setEditedOrder] = useState<any>({
    location_type: order.location_type,
    surface: order.surface,
    can_stake: order.surface === 'grass',
    generator_qty: order.generator_qty || 0,
    start_window: order.start_window,
    end_window: order.end_window,
    event_date: order.event_date?.split('T')[0] || order.event_date,
    event_end_date: (order.event_end_date || order.event_date)?.split('T')[0] || order.event_date,
    address_line1: order.addresses?.line1 || '',
    address_line2: order.addresses?.line2 || '',
    address_city: order.addresses?.city || '',
    address_state: order.addresses?.state || '',
    address_zip: order.addresses?.zip || '',
    pickup_preference: order.pickup_preference || 'next_day',
  });
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [adminSettings, setAdminSettings] = useState<any>(null);
  const [adminOverrideApproval, setAdminOverrideApproval] = useState(false);
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');
  const [currentOrderSummary, setCurrentOrderSummary] = useState<any>(null);
  const [taxWaived, setTaxWaived] = useState(order.tax_waived || false);
  const [taxWaiveReason, setTaxWaiveReason] = useState(order.tax_waive_reason || '');
  const [travelFeeWaived, setTravelFeeWaived] = useState(order.travel_fee_waived || false);
  const [travelFeeWaiveReason, setTravelFeeWaiveReason] = useState(order.travel_fee_waive_reason || '');
  const [sameDayPickupFeeWaived, setSameDayPickupFeeWaived] = useState(order.same_day_pickup_fee_waived || false);
  const [sameDayPickupFeeWaiveReason, setSameDayPickupFeeWaiveReason] = useState(order.same_day_pickup_fee_waive_reason || '');
  const [surfaceFeeWaived, setSurfaceFeeWaived] = useState(order.surface_fee_waived || false);
  const [surfaceFeeWaiveReason, setSurfaceFeeWaiveReason] = useState(order.surface_fee_waive_reason || '');
  const [generatorFeeWaived, setGeneratorFeeWaived] = useState(order.generator_fee_waived || false);
  const [generatorFeeWaiveReason, setGeneratorFeeWaiveReason] = useState(order.generator_fee_waive_reason || '');

  const { updatedOrderSummary, calculatedPricing, recalculatePricing } = useOrderPricing();
  const { payments, pricingRules, reload: reloadOrderData } = useOrderDetails(order.id);

  useEffect(() => {
    // Load current order summary for display
    const loadCurrentSummary = async () => {
      let travelMiles = parseFloat(order.travel_total_miles) || 0;

      // If order has travel fee but no miles (old orders), calculate miles from address
      if (order.travel_fee_cents > 0 && travelMiles === 0 && order.addresses?.lat && order.addresses?.lng) {
        try {
          const lat = parseFloat(order.addresses.lat);
          const lng = parseFloat(order.addresses.lng);
          if (lat !== 0 && lng !== 0) {
            travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);

            // Update the order in database with calculated miles
            if (travelMiles > 0) {
              await supabase
                .from('orders')
                .update({ travel_total_miles: travelMiles })
                .eq('id', order.id);
            }
          }
        } catch (error) {
          console.error('Error calculating travel miles for old order:', error);
        }
      }

      const summaryData: OrderSummaryData = {
        items: orderItems,
        discounts: discounts.filter(d => !d.is_new),
        customFees: customFees.filter(f => !f.is_new),
        subtotal_cents: order.subtotal_cents,
        travel_fee_cents: order.travel_fee_cents || 0,
        travel_total_miles: travelMiles,
        surface_fee_cents: order.surface_fee_cents || 0,
        same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
        generator_fee_cents: order.generator_fee_cents || 0,
        generator_qty: order.generator_qty || 0,
        tax_cents: order.tax_cents || 0,
        tip_cents: order.tip_cents || 0,
        total_cents: order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents,
        deposit_due_cents: order.deposit_due_cents,
        deposit_paid_cents: order.deposit_paid_cents || 0,
        balance_due_cents: order.balance_due_cents,
        custom_deposit_cents: order.custom_deposit_cents,
        pickup_preference: order.pickup_preference,
        event_date: order.event_date,
        event_end_date: order.event_end_date,
      };
      setCurrentOrderSummary(formatOrderSummary(summaryData));
    };

    if (orderItems.length > 0) {
      loadCurrentSummary();
    }
  }, [orderItems, order]);

  useEffect(() => {
    loadOrderDetails();
    loadAdminSettings();
  }, [order.id]);

  // Initialize staged items from order items
  useEffect(() => {
    if (orderItems.length > 0 && stagedItems.length === 0) {
      const staged = orderItems.map(item => ({
        id: item.id,
        unit_id: item.unit_id,
        unit_name: item.units?.name || 'Unknown',
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
        is_new: false,
        is_deleted: false,
      }));
      setStagedItems(staged);
    }
  }, [orderItems]);

  // Recalculate pricing whenever discounts, custom fees, staged items, or fee waivers change
  useEffect(() => {
    if (pricingRules && editedOrder && stagedItems.length > 0) {
      handleRecalculatePricing();
    }
  }, [discounts, customFees, stagedItems, editedOrder.location_type, editedOrder.surface, editedOrder.generator_qty, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived]);

  // Check if any changes have been made
  useEffect(() => {
    const orderChanged =
      editedOrder.location_type !== order.location_type ||
      editedOrder.surface !== order.surface ||
      editedOrder.generator_qty !== (order.generator_qty || 0) ||
      editedOrder.start_window !== order.start_window ||
      editedOrder.end_window !== order.end_window ||
      editedOrder.event_date !== order.event_date ||
      editedOrder.event_end_date !== (order.event_end_date || order.event_date) ||
      editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
      editedOrder.address_line2 !== (order.addresses?.line2 || '') ||
      editedOrder.address_city !== (order.addresses?.city || '') ||
      editedOrder.address_state !== (order.addresses?.state || '') ||
      editedOrder.address_zip !== (order.addresses?.zip || '') ||
      editedOrder.pickup_preference !== (order.pickup_preference || 'next_day');

    const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);

    setHasChanges(orderChanged || itemsChanged);
  }, [editedOrder, stagedItems, order]);

  // Handle multi-day logic: if dates are different, lock to next_day pickup
  useEffect(() => {
    if (editedOrder.event_date !== editedOrder.event_end_date) {
      if (editedOrder.pickup_preference === 'same_day') {
        setEditedOrder((prev: any) => ({ ...prev, pickup_preference: 'next_day' }));
      }
    }
  }, [editedOrder.event_date, editedOrder.event_end_date]);

  // Sync surface with can_stake
  useEffect(() => {
    if (editedOrder.can_stake && editedOrder.surface !== 'grass') {
      setEditedOrder((prev: any) => ({ ...prev, surface: 'grass' }));
    } else if (!editedOrder.can_stake && editedOrder.surface === 'grass') {
      setEditedOrder((prev: any) => ({ ...prev, surface: 'cement' }));
    }
  }, [editedOrder.can_stake]);

  // Check availability when dates or items change
  useEffect(() => {
    if (stagedItems.length > 0 && editedOrder.event_date && editedOrder.event_end_date) {
      const timer = setTimeout(() => {
        checkAvailability();
      }, 500); // Debounce for 500ms
      return () => clearTimeout(timer);
    }
  }, [editedOrder.event_date, editedOrder.event_end_date, stagedItems]);

  async function loadAdminSettings() {
    try {
      const { data, error } = await supabase.from('admin_settings').select('*');
      if (error) throw error;

      if (data) {
        const settings: any = {};
        data.forEach((s: any) => {
          settings[s.key] = s.value;
        });
        setAdminSettings(settings);
      }
    } catch (error) {
      console.error('Error loading admin settings:', error);
    }
  }

  async function checkAvailability() {
    if (!editedOrder.event_date || !editedOrder.event_end_date || stagedItems.length === 0) {
      setAvailabilityIssues([]);
      return;
    }

    setCheckingAvailability(true);
    try {
      const activeItems = stagedItems.filter(item => !item.is_deleted);
      const checks = activeItems.map(item => ({
        unitId: item.unit_id,
        eventStartDate: editedOrder.event_date,
        eventEndDate: editedOrder.event_end_date,
        excludeOrderId: order.id, // Exclude current order from conflict check
      }));

      const results = await checkMultipleUnitsAvailability(checks);
      const issues = results
        .filter(result => !result.isAvailable)
        .map(result => {
          const item = activeItems.find(i => i.unit_id === result.unitId);
          return {
            unitName: item?.unit_name || 'Unknown',
            unitId: result.unitId,
            conflicts: result.conflictingOrders,
          };
        });

      setAvailabilityIssues(issues);
    } catch (error) {
      console.error('Error checking availability:', error);
    } finally {
      setCheckingAvailability(false);
    }
  }

  const handleRecalculatePricing = useCallback(async () => {
    if (!pricingRules || !adminSettings) return;
    await recalculatePricing({
      order,
      editedOrder,
      stagedItems,
      discounts,
      customFees,
      customDepositCents,
      pricingRules,
      taxWaived,
      travelFeeWaived,
      sameDayPickupFeeWaived,
      surfaceFeeWaived,
      generatorFeeWaived,
    });
  }, [order, editedOrder, stagedItems, discounts, customFees, customDepositCents, pricingRules, adminSettings, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived, recalculatePricing]);

  async function loadOrderDetails() {
    try {
      const [itemsRes, notesRes, eventsRes, changelogRes, unitsRes, discountsRes, customFeesRes] = await Promise.all([
        supabase.from('order_items').select('*, units(name, price_dry_cents, price_water_cents)').eq('order_id', order.id),
        supabase.from('order_notes').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_workflow_events').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_changelog').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('units').select('*').eq('active', true).order('name'),
        supabase.from('order_discounts').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_custom_fees').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
      ]);

      if (itemsRes.data) setOrderItems(itemsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (eventsRes.data) setWorkflowEvents(eventsRes.data);
      if (changelogRes.data) setChangelog(changelogRes.data);
      if (unitsRes.data) setAvailableUnits(unitsRes.data);
      if (discountsRes.data) setDiscounts(discountsRes.data);
      if (customFeesRes.data) setCustomFees(customFeesRes.data);
    } catch (error) {
      console.error('Error loading order details:', error);
    }
  }

  async function logChange(field: string, oldValue: any, newValue: any, action: 'update' | 'add' | 'remove' = 'update') {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      await supabase.from('order_changelog').insert({
        order_id: order.id,
        user_id: user?.id,
        field_changed: field,
        old_value: String(oldValue),
        new_value: String(newValue),
        change_type: action === 'update' ? 'edit' : action === 'add' ? 'add' : 'remove',
      });
    } catch (error) {
      console.error('Error logging change:', error);
    }
  }

  const stageAddItem = useCallback((unit: any, mode: 'dry' | 'water') => {
    const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

    const newItem: StagedItem = {
      unit_id: unit.id,
      unit_name: unit.name,
      qty: 1,
      wet_or_dry: mode,
      unit_price_cents: price,
      is_new: true,
      is_deleted: false,
    };

    setStagedItems(prev => [...prev, newItem]);
  }, []);

  const stageRemoveItem = useCallback((itemToRemove: StagedItem) => {
    setStagedItems(prev => prev.map(item => {
      // Match by id if it exists, otherwise match by unit_id and wet_or_dry
      const isMatch = item.id
        ? item.id === itemToRemove.id
        : item.unit_id === itemToRemove.unit_id && item.wet_or_dry === itemToRemove.wet_or_dry;

      if (isMatch) {
        if (item.is_new) {
          // Don't include new items (filter them out)
          return null;
        } else {
          // Mark existing items as deleted
          return { ...item, is_deleted: true };
        }
      }
      return item;
    }).filter((item): item is StagedItem => item !== null));
  }, []);

  async function handleSaveChanges() {
    await checkAvailability();

    setSaving(true);
    try {
      await saveOrderChanges({
        order,
        editedOrder,
        stagedItems,
        discounts,
        customFees,
        calculatedPricing,
        customDepositCents,
        adminMessage,
        adminOverrideApproval,
        availabilityIssues,
        taxWaived,
        taxWaiveReason,
        travelFeeWaived,
        travelFeeWaiveReason,
        sameDayPickupFeeWaived,
        sameDayPickupFeeWaiveReason,
        surfaceFeeWaived,
        surfaceFeeWaiveReason,
        generatorFeeWaived,
        generatorFeeWaiveReason,
        logChangeFn: logChange,
        sendNotificationsFn: async () => {
          await sendOrderEditNotifications({ order, adminMessage });
        },
        onComplete: async () => {
          await loadOrderDetails();
          onUpdate();
          onClose();
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message !== 'Availability conflict') {
        console.error('Error saving changes:', error);
      }
    } finally {
      setSaving(false);
    }
  }

  function initiateStatusChange(newStatus: string) {
    setPendingStatus(newStatus);
    setShowStatusDialog(true);
  }

  // Memoized callbacks to prevent child component re-renders
  const handleOrderChange = useCallback((updates: any) => {
    setEditedOrder((prev: any) => ({ ...prev, ...updates }));
    setHasChanges(true);
  }, []);

  const handleAddressSelect = useCallback((result: any) => {
    setEditedOrder((prev: any) => ({
      ...prev,
      address_line1: result.street,
      address_city: result.city,
      address_state: result.state,
      address_zip: result.zip,
    }));
    setHasChanges(true);
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 md:p-4 overflow-y-auto">
      <div className="bg-white md:rounded-lg max-w-6xl w-full min-h-screen md:min-h-0 md:my-8">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-3 md:px-6 py-3 md:py-4 flex items-center justify-between md:rounded-t-lg z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-2xl font-bold text-slate-900 truncate">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="text-xs md:text-sm text-slate-600 truncate">
              {order.customers?.first_name} {order.customers?.last_name} • {format(new Date(order.event_date), 'MMM d, yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-1 md:gap-2 shrink-0">
            {hasChanges && (
              <>
                <label className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 px-2 md:px-3 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-amber-100">
                  <input
                    type="checkbox"
                    checked={adminOverrideApproval}
                    onChange={(e) => setAdminOverrideApproval(e.target.checked)}
                    className="w-3.5 h-3.5 md:w-4 md:h-4"
                  />
                  <span className="hidden lg:inline">Skip Customer Approval</span>
                  <span className="lg:hidden">Skip Approval</span>
                </label>
                <button
                  onClick={handleSaveChanges}
                  disabled={saving}
                  className="flex items-center gap-1 md:gap-2 bg-green-600 hover:bg-green-700 text-white px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-sm md:text-base font-medium disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save Changes'}</span>
                  <span className="sm:hidden">{saving ? '...' : 'Save'}</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
        </div>

        <div className="px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-slate-50">
          {/* Mobile Dropdown */}
          <div className="md:hidden">
            <select
              value={activeSection}
              onChange={(e) => setActiveSection(e.target.value as any)}
              className="w-full px-3 py-2 bg-white border-2 border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="details">Details</option>
              <option value="workflow">Workflow</option>
              <option value="payments">Payments</option>
              <option value="notes">Notes</option>
              <option value="changelog">Changelog</option>
            </select>
          </div>

          {/* Desktop Tabs */}
          <div className="hidden md:flex space-x-1">
            {(['details', 'workflow', 'payments', 'notes', 'changelog'] as const).map(section => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                  activeSection === section
                    ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {section === 'details' && <FileText className="w-4 h-4 inline mr-2" />}
                {section === 'workflow' && <Truck className="w-4 h-4 inline mr-2" />}
                {section === 'payments' && <CreditCard className="w-4 h-4 inline mr-2" />}
                {section === 'notes' && <MessageSquare className="w-4 h-4 inline mr-2" />}
                {section === 'changelog' && <History className="w-4 h-4 inline mr-2" />}
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 md:px-6 py-4 md:py-6 max-h-[calc(100vh-200px)] md:max-h-[calc(100vh-300px)] overflow-y-auto">
          {activeSection === 'details' && (
            <OrderDetailsTab
              order={order}
              checkingAvailability={checkingAvailability}
              availabilityIssues={availabilityIssues}
              stagedItems={stagedItems}
              editedOrder={editedOrder}
              pricingRules={pricingRules}
              availableUnits={availableUnits}
              currentOrderSummary={currentOrderSummary}
              updatedOrderSummary={updatedOrderSummary}
              hasChanges={hasChanges}
              calculatedPricing={calculatedPricing}
              customDepositCents={customDepositCents}
              discounts={discounts}
              customFees={customFees}
              customDepositInput={customDepositInput}
              adminMessage={adminMessage}
              taxWaived={taxWaived}
              taxWaiveReason={taxWaiveReason}
              travelFeeWaived={travelFeeWaived}
              travelFeeWaiveReason={travelFeeWaiveReason}
              sameDayPickupFeeWaived={sameDayPickupFeeWaived}
              sameDayPickupFeeWaiveReason={sameDayPickupFeeWaiveReason}
              onOrderChange={handleOrderChange}
              onAddressSelect={handleAddressSelect}
              onRemoveItem={stageRemoveItem}
              onAddItem={stageAddItem}
              onDiscountsChange={setDiscounts}
              onFeesChange={setCustomFees}
              onDepositInputChange={setCustomDepositInput}
              onDepositApply={(amountCents) => {
                setCustomDepositCents(amountCents);
                setHasChanges(true);
              }}
              onDepositClear={() => {
                setCustomDepositCents(null);
                setCustomDepositInput('');
                setHasChanges(true);
              }}
              onAdminMessageChange={(value) => {
                setAdminMessage(value);
                setHasChanges(true);
              }}
              onTaxWaivedToggle={(reason) => {
                setTaxWaived(!taxWaived);
                setTaxWaiveReason(reason);
                setHasChanges(true);
              }}
              onTravelFeeWaivedToggle={(reason) => {
                setTravelFeeWaived(!travelFeeWaived);
                setTravelFeeWaiveReason(reason);
                setHasChanges(true);
              }}
              onSameDayPickupFeeWaivedToggle={(reason) => {
                setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
                setSameDayPickupFeeWaiveReason(reason);
                setHasChanges(true);
              }}
              surfaceFeeWaived={surfaceFeeWaived}
              surfaceFeeWaiveReason={surfaceFeeWaiveReason}
              onSurfaceFeeWaivedToggle={(reason) => {
                setSurfaceFeeWaived(!surfaceFeeWaived);
                setSurfaceFeeWaiveReason(reason);
                setHasChanges(true);
              }}
              generatorFeeWaived={generatorFeeWaived}
              generatorFeeWaiveReason={generatorFeeWaiveReason}
              onGeneratorFeeWaivedToggle={(reason) => {
                setGeneratorFeeWaived(!generatorFeeWaived);
                setGeneratorFeeWaiveReason(reason);
                setHasChanges(true);
              }}
              onStatusChange={initiateStatusChange}
              onMarkChanges={() => setHasChanges(true)}
            />
          )}

          {activeSection === 'workflow' && (
            <OrderWorkflowTab workflowEvents={workflowEvents} />
          )}

          {activeSection === 'payments' && (
            <PaymentsTab
              orderId={order.id}
              customerName={`${order.customers?.first_name} ${order.customers?.last_name}`}
              payments={payments}
              onPaymentsUpdate={() => {
                reloadOrderData();
                onUpdate();
              }}
            />
          )}

          {activeSection === 'notes' && (
            <OrderNotesTab orderId={order.id} notes={notes} onNotesChanged={loadOrderDetails} />
          )}

          {activeSection === 'changelog' && (
            <OrderChangelogTab changelog={changelog} />
          )}
        </div>
      </div>

      <StatusChangeDialog
        isOpen={showStatusDialog}
        onClose={() => {
          setShowStatusDialog(false);
          setPendingStatus('');
        }}
        orderId={order.id}
        currentStatus={order.status}
        pendingStatus={pendingStatus}
        stagedItems={stagedItems}
        eventDate={editedOrder.event_date}
        eventEndDate={editedOrder.event_end_date}
        onStatusChanged={async () => {
          await loadOrderDetails();
          onUpdate();
        }}
      />
    </div>
  );
}
