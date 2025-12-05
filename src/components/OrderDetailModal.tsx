import { useState, useEffect } from 'react';
import { X, Truck, MapPin, CheckCircle, MessageSquare, FileText, Edit2, History, Save, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { formatCurrency, calculateDistance, calculatePrice, calculateDrivingDistance, type PricingRules, type PriceBreakdown } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { AddressAutocomplete } from './AddressAutocomplete';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { OrderSummary } from './OrderSummary';
import { formatOrderSummary, type OrderSummaryData } from '../lib/orderSummary';

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
  const [activeSection, setActiveSection] = useState<'details' | 'workflow' | 'notes' | 'changelog'>('details');
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<any[]>([]);
  const [changelog, setChangelog] = useState<any[]>([]);
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [eta, setEta] = useState('');
  const [isEditing, setIsEditing] = useState(true);
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
  const [newDiscount, setNewDiscount] = useState({ name: '', amount_cents: 0, percentage: 0 });
  const [discountAmountInput, setDiscountAmountInput] = useState('0.00');
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [newCustomFee, setNewCustomFee] = useState({ name: '', amount_cents: 0 });
  const [customFeeInput, setCustomFeeInput] = useState('0.00');
  const [adminMessage, setAdminMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedDiscountTemplates, setSavedDiscountTemplates] = useState<any[]>([]);
  const [savedFeeTemplates, setSavedFeeTemplates] = useState<any[]>([]);
  const [saveDiscountAsTemplate, setSaveDiscountAsTemplate] = useState(false);
  const [saveFeeAsTemplate, setSaveFeeAsTemplate] = useState(false);
  const [selectedDiscountTemplateId, setSelectedDiscountTemplateId] = useState<string>('');
  const [selectedFeeTemplateId, setSelectedFeeTemplateId] = useState<string>('');
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [statusChangeReason, setStatusChangeReason] = useState('');
  const [pricingRules, setPricingRules] = useState<any>(null);
  const [adminSettings, setAdminSettings] = useState<any>(null);
  const [adminOverrideApproval, setAdminOverrideApproval] = useState(false);
  const [calculatedPricing, setCalculatedPricing] = useState<any>(null);
  const [updatedOrderSummary, setUpdatedOrderSummary] = useState<any>(null);
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');
  const [currentOrderSummary, setCurrentOrderSummary] = useState<any>(null);

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
    loadPricingData();
    loadSavedTemplates();
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

  // Recalculate pricing whenever discounts, custom fees, or staged items change
  useEffect(() => {
    if (pricingRules && editedOrder && stagedItems.length > 0) {
      recalculatePricing();
    }
  }, [discounts, customFees, stagedItems, editedOrder.location_type, editedOrder.surface, editedOrder.generator_qty]);

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

  // Recalculate pricing whenever staged items, discounts, or order details change
  useEffect(() => {
    if (pricingRules && adminSettings && stagedItems.length > 0) {
      recalculatePricing();
    }
  }, [stagedItems, discounts, editedOrder, pricingRules, adminSettings]);

  // Check availability when dates or items change
  useEffect(() => {
    if (stagedItems.length > 0 && editedOrder.event_date && editedOrder.event_end_date) {
      const timer = setTimeout(() => {
        checkAvailability();
      }, 500); // Debounce for 500ms
      return () => clearTimeout(timer);
    }
  }, [editedOrder.event_date, editedOrder.event_end_date, stagedItems]);

  async function loadPricingData() {
    try {
      const [rulesRes, settingsRes] = await Promise.all([
        supabase.from('pricing_rules').select('*').single(),
        supabase.from('admin_settings').select('*'),
      ]);

      if (rulesRes.data) setPricingRules(rulesRes.data);
      if (settingsRes.data) {
        const settings: any = {};
        settingsRes.data.forEach((s: any) => {
          settings[s.key] = s.value;
        });
        setAdminSettings(settings);
      }
    } catch (error) {
      console.error('Error loading pricing data:', error);
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

  async function recalculatePricing() {
    if (!pricingRules || !adminSettings) return;

    try {
      // Check if address has changed
      const addressChanged =
        editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
        editedOrder.address_city !== (order.addresses?.city || '') ||
        editedOrder.address_state !== (order.addresses?.state || '') ||
        editedOrder.address_zip !== (order.addresses?.zip || '');

      let distance_miles = 0;
      let useSavedTravelFee = false;

      // If address hasn't changed, use the stored travel fee and miles
      if (!addressChanged && order.travel_fee_cents > 0) {
        distance_miles = parseFloat(order.travel_total_miles) || 0;
        useSavedTravelFee = true;
      } else {
        // Address changed, so recalculate distance
        let lat = 0;
        let lng = 0;

        if (editedOrder.address_line1 && editedOrder.address_city && window.google?.maps) {
          try {
            const geocoder = new google.maps.Geocoder();
            const destination = `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`;
            const result = await geocoder.geocode({ address: destination });
            if (result.results && result.results[0]) {
              const location = result.results[0].geometry.location;
              lat = location.lat();
              lng = location.lng();
            }
          } catch (error) {
            console.error('Geocoding error:', error);
            // Fall back to order's stored coordinates if geocoding fails
            lat = parseFloat(order.addresses?.lat) || 0;
            lng = parseFloat(order.addresses?.lng) || 0;
          }
        } else {
          // Use order's stored coordinates if address is incomplete
          lat = parseFloat(order.addresses?.lat) || 0;
          lng = parseFloat(order.addresses?.lng) || 0;
        }

        // Only calculate distance if we have valid coordinates
        if (lat !== 0 && lng !== 0) {
          distance_miles = await calculateDrivingDistance(
            HOME_BASE.lat,
            HOME_BASE.lng,
            lat,
            lng
          );
        }

        // If distance calculation failed or returned 0, use stored travel distance
        if (distance_miles === 0 && order.travel_total_miles) {
          distance_miles = parseFloat(order.travel_total_miles) || 0;
        }
      }

      // Convert staged items to calculatePrice format
      const activeItems = stagedItems.filter(item => !item.is_deleted);
      const items = activeItems.map(item => ({
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
      }));

      // Calculate number of days
      const eventStartDate = new Date(editedOrder.event_date);
      const eventEndDate = new Date(editedOrder.event_end_date || editedOrder.event_date);
      const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
      const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      // Build pricing rules from database format
      const rules: PricingRules = {
        base_radius_miles: parseFloat(pricingRules.base_radius_miles) || 20,
        included_city_list_json: pricingRules.included_city_list_json || [],
        per_mile_after_base_cents: pricingRules.per_mile_after_base_cents || 500,
        zone_overrides_json: pricingRules.zone_overrides_json || [],
        surface_sandbag_fee_cents: pricingRules.surface_sandbag_fee_cents || 0,
        residential_multiplier: parseFloat(pricingRules.residential_multiplier) || 1,
        commercial_multiplier: parseFloat(pricingRules.commercial_multiplier) || 1,
        same_day_matrix_json: pricingRules.same_day_matrix_json || [],
        overnight_holiday_only: pricingRules.overnight_holiday_only || false,
        extra_day_pct: parseFloat(pricingRules.extra_day_pct) || 0,
        generator_price_cents: pricingRules.generator_price_cents || 0,
      };

      // Use centralized calculatePrice function
      const priceBreakdown = calculatePrice({
        items,
        location_type: editedOrder.location_type as 'residential' | 'commercial',
        surface: editedOrder.surface as 'grass' | 'cement',
        can_use_stakes: editedOrder.surface === 'grass',
        overnight_allowed: editedOrder.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles,
        city: editedOrder.address_city,
        zip: editedOrder.address_zip,
        has_generator: (editedOrder.generator_qty || 0) > 0,
        generator_qty: editedOrder.generator_qty || 0,
        rules,
      });

      // Convert staged items to order items format for summary display
      const activeItemsForDisplay = activeItems.map(item => ({
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.wet_or_dry,
        unit_price_cents: item.unit_price_cents,
        is_new: item.is_new || false,
        units: {
          name: item.unit_name,
          price_dry_cents: item.wet_or_dry === 'dry' ? item.unit_price_cents : 0,
          price_water_cents: item.wet_or_dry === 'water' ? item.unit_price_cents : 0,
        }
      }));

      // Build order data using the centralized price breakdown
      // If address hasn't changed, preserve original travel fee and miles
      const finalTravelFeeCents = useSavedTravelFee ? order.travel_fee_cents : priceBreakdown.travel_fee_cents;
      const finalTravelMiles = useSavedTravelFee ? (parseFloat(order.travel_total_miles) || 0) : (priceBreakdown.travel_total_miles || 0);

      // Recalculate tax and total if we're using saved travel fee
      let finalTaxCents = priceBreakdown.tax_cents;
      let finalTotalCents = priceBreakdown.total_cents;

      if (useSavedTravelFee && finalTravelFeeCents !== priceBreakdown.travel_fee_cents) {
        // Recalculate tax based on: subtotal + travel + surface + generator
        finalTaxCents = Math.round((priceBreakdown.subtotal_cents + finalTravelFeeCents + priceBreakdown.surface_fee_cents + priceBreakdown.generator_fee_cents) * 0.06);

        // Recalculate total: subtotal + all fees + tax
        finalTotalCents = priceBreakdown.subtotal_cents + finalTravelFeeCents + priceBreakdown.surface_fee_cents + priceBreakdown.same_day_pickup_fee_cents + priceBreakdown.generator_fee_cents + finalTaxCents;
      }

      const updatedOrderData: OrderSummaryData = {
        items: activeItemsForDisplay,
        discounts,
        customFees,
        subtotal_cents: priceBreakdown.subtotal_cents,
        travel_fee_cents: finalTravelFeeCents,
        travel_total_miles: finalTravelMiles,
        surface_fee_cents: priceBreakdown.surface_fee_cents,
        same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents,
        generator_fee_cents: priceBreakdown.generator_fee_cents,
        generator_qty: editedOrder.generator_qty || 0,
        tax_cents: finalTaxCents,
        tip_cents: order.tip_cents || 0,
        total_cents: finalTotalCents,
        deposit_due_cents: customDepositCents !== null ? customDepositCents : priceBreakdown.deposit_due_cents,
        deposit_paid_cents: order.deposit_paid_cents || 0,
        balance_due_cents: customDepositCents !== null ? finalTotalCents - customDepositCents : (finalTotalCents - priceBreakdown.deposit_due_cents),
        custom_deposit_cents: customDepositCents,
        pickup_preference: editedOrder.pickup_preference,
        event_date: editedOrder.event_date,
        event_end_date: editedOrder.event_end_date,
        location_type: editedOrder.location_type,
        surface: editedOrder.surface,
      };

      // Use centralized calculation for summary display
      const summary = formatOrderSummary(updatedOrderData);

      console.log('🧮 Admin Panel Price Calculation (Fully Centralized):');
      console.log('Price Breakdown:', priceBreakdown);
      console.log('Summary:', summary);

      // Store full summary for display
      setUpdatedOrderSummary(summary);

      // Store calculated values for backward compatibility
      setCalculatedPricing({
        subtotal_cents: priceBreakdown.subtotal_cents,
        generator_fee_cents: priceBreakdown.generator_fee_cents,
        travel_fee_cents: finalTravelFeeCents,
        distance_miles: finalTravelMiles,
        surface_fee_cents: priceBreakdown.surface_fee_cents,
        same_day_pickup_fee_cents: priceBreakdown.same_day_pickup_fee_cents,
        custom_fees_total_cents: summary.customFees.reduce((sum, f) => sum + f.amount, 0),
        discount_total_cents: summary.discounts.reduce((sum, d) => sum + d.amount, 0),
        tax_cents: finalTaxCents,
        total_cents: summary.total,
        deposit_due_cents: summary.depositDue,
        balance_due_cents: summary.balanceDue,
      });
    } catch (error) {
      console.error('Error recalculating pricing:', error);
    }
  }

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

  async function loadSavedTemplates() {
    try {
      const [discountTemplatesRes, feeTemplatesRes] = await Promise.all([
        supabase.from('saved_discount_templates').select('*').order('name'),
        supabase.from('saved_fee_templates').select('*').order('name'),
      ]);

      if (discountTemplatesRes.data) setSavedDiscountTemplates(discountTemplatesRes.data);
      if (feeTemplatesRes.data) setSavedFeeTemplates(feeTemplatesRes.data);
    } catch (error) {
      console.error('Error loading saved templates:', error);
    }
  }

  async function handleAddNote() {
    if (!newNote.trim()) return;

    setSavingNote(true);
    try {
      const { error } = await supabase.from('order_notes').insert({
        order_id: order.id,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        note: newNote,
      });

      if (error) throw error;

      setNewNote('');
      await loadOrderDetails();
    } catch (error) {
      console.error('Error adding note:', error);
      alert('Failed to add note');
    } finally {
      setSavingNote(false);
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

  function stageAddItem(unit: any, mode: 'dry' | 'water') {
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

    setStagedItems([...stagedItems, newItem]);
  }

  function stageRemoveItem(itemToRemove: StagedItem) {
    const updatedItems = stagedItems.map(item => {
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
    }).filter((item): item is StagedItem => item !== null);

    setStagedItems(updatedItems);
  }

  async function handleSaveChanges() {
    // Check availability one final time before saving
    await checkAvailability();

    if (availabilityIssues.length > 0) {
      const unitNames = availabilityIssues.map(issue => issue.unitName).join(', ');
      alert(`Cannot save: The following units are not available for the selected dates: ${unitNames}\n\nPlease adjust the dates or remove the conflicting items.`);
      return;
    }

    setSaving(true);
    try {
      // Verify user is authenticated
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error('Authentication error:', authError);
        alert('You must be logged in to save changes.');
        setSaving(false);
        return;
      }
      console.log('User authenticated:', user.id);

      const changes: any = {};
      const logs = [];

      // Track order field changes
      if (editedOrder.location_type !== order.location_type) {
        changes.location_type = editedOrder.location_type;
        logs.push(['location_type', order.location_type, editedOrder.location_type]);
      }
      if (editedOrder.surface !== order.surface) {
        changes.surface = editedOrder.surface;
        logs.push(['surface', order.surface, editedOrder.surface]);
      }
      if (editedOrder.generator_qty !== (order.generator_qty || 0)) {
        changes.generator_qty = editedOrder.generator_qty;
        logs.push(['generator_qty', order.generator_qty || 0, editedOrder.generator_qty]);
      }
      if (editedOrder.start_window !== order.start_window) {
        changes.start_window = editedOrder.start_window;
        logs.push(['start_window', order.start_window, editedOrder.start_window]);
      }
      if (editedOrder.end_window !== order.end_window) {
        changes.end_window = editedOrder.end_window;
        logs.push(['end_window', order.end_window, editedOrder.end_window]);
      }
      // Normalize dates to YYYY-MM-DD format for comparison
      const normalizeDate = (dateStr: string) => {
        if (!dateStr) return '';
        return dateStr.split('T')[0]; // Extract YYYY-MM-DD from timestamp
      };

      const originalEventDate = normalizeDate(order.event_date);
      const editedEventDate = normalizeDate(editedOrder.event_date);

      console.log('Date comparison - Original:', originalEventDate, 'Edited:', editedEventDate);

      if (editedEventDate !== originalEventDate) {
        changes.event_date = editedOrder.event_date;
        changes.start_date = editedOrder.event_date; // Keep start_date in sync
        logs.push(['event_date', order.event_date, editedOrder.event_date]);
        console.log('✅ Event date changed from', originalEventDate, 'to', editedEventDate);
      }

      const originalEventEndDate = normalizeDate(order.event_end_date || order.event_date);
      const editedEventEndDate = normalizeDate(editedOrder.event_end_date);

      console.log('End date comparison - Original:', originalEventEndDate, 'Edited:', editedEventEndDate);

      if (editedEventEndDate !== originalEventEndDate) {
        changes.event_end_date = editedOrder.event_end_date;
        changes.end_date = editedOrder.event_end_date; // Keep end_date in sync
        logs.push(['event_end_date', order.event_end_date || order.event_date, editedOrder.event_end_date]);
        console.log('✅ Event end date changed from', originalEventEndDate, 'to', editedEventEndDate);
      }
      if (editedOrder.pickup_preference !== (order.pickup_preference || 'next_day')) {
        changes.pickup_preference = editedOrder.pickup_preference;
        changes.overnight_allowed = editedOrder.pickup_preference === 'next_day';
        logs.push(['pickup_preference', order.pickup_preference || 'next_day', editedOrder.pickup_preference]);
      }

      // Handle address changes
      const addressChanged =
        editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
        editedOrder.address_city !== (order.addresses?.city || '') ||
        editedOrder.address_state !== (order.addresses?.state || '') ||
        editedOrder.address_zip !== (order.addresses?.zip || '');

      if (addressChanged) {
        await supabase.from('addresses').update({
          line1: editedOrder.address_line1,
          line2: editedOrder.address_line2,
          city: editedOrder.address_city,
          state: editedOrder.address_state,
          zip: editedOrder.address_zip,
        }).eq('id', order.address_id);

        logs.push(['address',
          `${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state} ${order.addresses?.zip}`,
          `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`
        ]);
      }

      // Apply calculated pricing
      if (calculatedPricing) {
        changes.subtotal_cents = calculatedPricing.subtotal_cents;
        changes.generator_fee_cents = calculatedPricing.generator_fee_cents;
        changes.travel_fee_cents = calculatedPricing.travel_fee_cents;
        changes.travel_total_miles = calculatedPricing.travel_total_miles;
        changes.travel_base_radius_miles = calculatedPricing.travel_base_radius_miles;
        changes.travel_chargeable_miles = calculatedPricing.travel_chargeable_miles;
        changes.travel_per_mile_cents = calculatedPricing.travel_per_mile_cents;
        changes.travel_is_flat_fee = calculatedPricing.travel_is_flat_fee;
        changes.surface_fee_cents = calculatedPricing.surface_fee_cents;
        changes.same_day_pickup_fee_cents = calculatedPricing.same_day_pickup_fee_cents;
        changes.tax_cents = calculatedPricing.tax_cents;

        // Apply custom deposit override if set
        const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
        changes.deposit_due_cents = finalDepositCents;
        changes.balance_due_cents = calculatedPricing.total_cents - finalDepositCents;

        // Log all pricing changes that matter to the customer
        if (calculatedPricing.subtotal_cents !== order.subtotal_cents) {
          logs.push(['subtotal', order.subtotal_cents, calculatedPricing.subtotal_cents]);
        }
        if (calculatedPricing.generator_fee_cents !== (order.generator_fee_cents || 0)) {
          logs.push(['generator_fee', order.generator_fee_cents || 0, calculatedPricing.generator_fee_cents]);
        }
        if (calculatedPricing.travel_fee_cents !== order.travel_fee_cents) {
          logs.push(['travel_fee', order.travel_fee_cents, calculatedPricing.travel_fee_cents]);
        }
        if (calculatedPricing.surface_fee_cents !== order.surface_fee_cents) {
          logs.push(['surface_fee', order.surface_fee_cents, calculatedPricing.surface_fee_cents]);
        }
        if (calculatedPricing.same_day_pickup_fee_cents !== (order.same_day_pickup_fee_cents || 0)) {
          logs.push(['same_day_pickup_fee', order.same_day_pickup_fee_cents || 0, calculatedPricing.same_day_pickup_fee_cents]);
        }
        if (calculatedPricing.tax_cents !== order.tax_cents) {
          logs.push(['tax', order.tax_cents, calculatedPricing.tax_cents]);
        }
        if (finalDepositCents !== order.deposit_due_cents) {
          logs.push(['deposit_due', order.deposit_due_cents, finalDepositCents]);
        }

        const newBalanceDue = calculatedPricing.total_cents - finalDepositCents;
        if (newBalanceDue !== order.balance_due_cents) {
          logs.push(['balance_due', order.balance_due_cents, newBalanceDue]);
        }

        // Log total change for easy customer understanding
        const newTotal = calculatedPricing.total_cents;
        const oldTotal = order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + (order.same_day_pickup_fee_cents || 0) + order.tax_cents;
        if (newTotal !== oldTotal) {
          logs.push(['total', oldTotal, newTotal]);
        }
      }

      // Determine if we need to clear payment method
      let shouldClearPayment = false;
      const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);

      if (itemsChanged) {
        // Items were added or removed - always clear payment
        shouldClearPayment = true;
        logs.push(['payment_method', 'cleared', 'items changed']);
      } else if (calculatedPricing && order.stripe_payment_intent_id) {
        // No item changes, but check if deposit increased
        const finalDepositCents = customDepositCents !== null ? customDepositCents : calculatedPricing.deposit_due_cents;
        const currentPaidAmount = order.stripe_amount_paid_cents || 0;

        if (finalDepositCents > currentPaidAmount) {
          // New deposit is higher than what was paid - clear payment
          shouldClearPayment = true;
          logs.push(['payment_method', 'cleared', `deposit increased from ${currentPaidAmount} to ${finalDepositCents}`]);
        } else if (currentPaidAmount >= (order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)) {
          // Customer paid in full originally
          const newTotal = calculatedPricing.total_cents;
          if (newTotal > currentPaidAmount) {
            // New total exceeds what was paid - clear payment
            shouldClearPayment = true;
            logs.push(['payment_method', 'cleared', `paid in full but total increased from ${currentPaidAmount} to ${newTotal}`]);
          }
        }
      }

      // Clear payment method if needed
      if (shouldClearPayment) {
        changes.stripe_payment_method_id = null;
        changes.stripe_payment_status = 'unpaid';
      }

      // Handle item changes
      for (const item of stagedItems) {
        if (item.is_new && !item.is_deleted) {
          // Add new item
          await supabase.from('order_items').insert({
            order_id: order.id,
            unit_id: item.unit_id,
            qty: item.qty,
            wet_or_dry: item.wet_or_dry,
            unit_price_cents: item.unit_price_cents,
          });
          await logChange('order_items', '', `${item.unit_name} (${item.wet_or_dry})`, 'add');
        } else if (item.is_deleted && item.id) {
          // Remove item
          await supabase.from('order_items').delete().eq('id', item.id);
          await logChange('order_items', `${item.unit_name} (${item.wet_or_dry})`, '', 'remove');
        }
      }

      // Handle staged discounts
      console.log('Saving discounts:', discounts);
      const insertedDiscountIds: string[] = [];

      for (const discount of discounts) {
        if (discount.is_new) {
          console.log('Inserting new discount:', discount);
          // Add new discount
          const { data, error } = await supabase.from('order_discounts').insert({
            order_id: order.id,
            name: discount.name,
            amount_cents: discount.amount_cents,
            percentage: discount.percentage,
          }).select();
          if (error) {
            console.error('Error inserting discount:', error);
            throw new Error(`Failed to save discount: ${error.message}`);
          }
          console.log('Discount inserted successfully:', data);

          // Track the newly inserted discount ID
          if (data && data[0]) {
            insertedDiscountIds.push(data[0].id);
          }

          await logChange('discounts', '', discount.name, 'add');
        }
      }

      // Remove discounts that were deleted (check against original list)
      const originalDiscounts = await supabase.from('order_discounts').select('*').eq('order_id', order.id);
      if (originalDiscounts.data) {
        // Include both existing discount IDs and newly inserted ones
        const currentDiscountIds = [
          ...discounts.filter(d => !d.is_new).map(d => d.id),
          ...insertedDiscountIds
        ];
        const deletedDiscounts = originalDiscounts.data.filter(od => !currentDiscountIds.includes(od.id));
        for (const deleted of deletedDiscounts) {
          console.log('Deleting discount:', deleted);
          await supabase.from('order_discounts').delete().eq('id', deleted.id);
          await logChange('discounts', deleted.name, '', 'remove');
        }
      }

      // Handle staged custom fees
      console.log('Saving custom fees:', customFees);
      const insertedFeeIds: string[] = [];

      for (const fee of customFees) {
        if (fee.is_new) {
          console.log('Inserting new custom fee:', fee);
          // Add new custom fee
          const { data, error } = await supabase.from('order_custom_fees').insert({
            order_id: order.id,
            name: fee.name,
            amount_cents: fee.amount_cents,
          }).select();
          if (error) {
            console.error('Error inserting custom fee:', error);
            throw new Error(`Failed to save custom fee: ${error.message}`);
          }
          console.log('Custom fee inserted successfully:', data);

          // Track the newly inserted fee ID
          if (data && data[0]) {
            insertedFeeIds.push(data[0].id);
          }

          await logChange('custom_fees', '', fee.name, 'add');
        }
      }

      // Remove custom fees that were deleted (check against original list)
      const originalCustomFees = await supabase.from('order_custom_fees').select('*').eq('order_id', order.id);
      if (originalCustomFees.data) {
        // Include both existing fee IDs and newly inserted ones
        const currentFeeIds = [
          ...customFees.filter(f => !f.is_new).map(f => f.id),
          ...insertedFeeIds
        ];
        const deletedFees = originalCustomFees.data.filter(of => !currentFeeIds.includes(of.id));
        for (const deleted of deletedFees) {
          console.log('Deleting custom fee:', deleted);
          await supabase.from('order_custom_fees').delete().eq('id', deleted.id);
          await logChange('custom_fees', deleted.name, '', 'remove');
        }
      }

      // Save admin message if provided and log it
      if (adminMessage.trim()) {
        changes.admin_message = adminMessage.trim();
        // Log admin message as a change so it appears in changelog
        if (adminMessage.trim() !== (order.admin_message || '')) {
          logs.push(['admin_message', order.admin_message || '', adminMessage.trim()]);
        }
      }

      // Check if there are any actual changes to track
      const hasTrackedChanges = logs.length > 0 || stagedItems.some(item => item.is_new || item.is_deleted) || discounts.some(d => d.is_new) || customFees.some(f => f.is_new);
      const hasFieldChanges = Object.keys(changes).length > 0;

      // Only set awaiting_customer_approval status if there are actual changes
      if (hasTrackedChanges || hasFieldChanges) {
        // Check if admin wants to skip customer approval
        if (adminOverrideApproval) {
          // Skip customer approval: go directly to confirmed status, keep payment method
          changes.status = 'confirmed';
          console.log('Skipping customer approval - order confirmed immediately');
        } else {
          changes.status = 'awaiting_customer_approval';
        }

        // Update order
        const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
        if (updateError) {
          console.error('Error updating order:', updateError);
          throw new Error(`Failed to update order: ${updateError.message}`);
        }

        // Log all changes
        for (const [field, oldVal, newVal] of logs) {
          await logChange(field, oldVal, newVal);
        }

        // Only send notification if there are tracked changes for the customer to review AND admin didn't override
        if (hasTrackedChanges && !adminOverrideApproval) {
          await sendOrderEditNotifications();
        }
      } else {
        // No changes to track, just do a regular update without changing status
        if (hasFieldChanges) {
          const { error: updateError } = await supabase.from('orders').update(changes).eq('id', order.id);
          if (updateError) {
            console.error('Error updating order:', updateError);
            throw new Error(`Failed to update order: ${updateError.message}`);
          }
        }
      }

      await loadOrderDetails();
      onUpdate();
      if (hasTrackedChanges) {
        if (adminOverrideApproval) {
          alert('Changes saved and order confirmed! Customer approval was skipped - order is ready to go.');
        } else {
          alert('Changes saved successfully! Customer will be notified to review and approve the changes.');
        }
      } else {
        alert('Changes saved successfully!');
      }
      onClose();
    } catch (error) {
      console.error('Error saving changes:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to save changes: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  }

  async function sendOrderEditNotifications() {
    try {
      const customerPortalUrl = `${window.location.origin}/customer-portal/${order.id}`;
      const fullName = `${order.customers?.first_name} ${order.customers?.last_name}`.trim();

      const logoUrl = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Updated - Approval Needed</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 2px solid #3b82f6;">
            <div style="text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 25px;">
              <img src="${logoUrl}" alt="Bounce Party Club" style="height: 70px; width: auto;" />
              <h2 style="color: #3b82f6; margin: 15px 0 0;">Your Order Has Been Updated</h2>
            </div>
            <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">Hi ${fullName},</p>
            <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">
              We've made some updates to your booking (Order #${order.id.slice(0, 8).toUpperCase()}) and need your approval to proceed.
            </p>
            ${adminMessage.trim() ? `
            <div style="background-color: #dbeafe; border: 2px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 6px;">
              <p style="margin: 0; color: #1e40af; font-weight: 600;">Message from Bounce Party Club:</p>
              <p style="margin: 10px 0 0; color: #1e40af; white-space: pre-wrap;">${adminMessage}</p>
            </div>` : ''}
            <div style="background-color: #fef3c7; border: 2px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 6px;">
              <p style="margin: 0; color: #92400e; font-weight: 600;">Action Required</p>
              <p style="margin: 10px 0 0; color: #92400e;">Please review the updated details and approve or request changes.</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${customerPortalUrl}" style="display: inline-block; background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600;">
                Review Order Changes
              </a>
            </div>
            <p style="margin: 20px 0 0; color: #64748b; font-size: 14px;">
              If you have any questions, please contact us at (313) 889-3860.
            </p>
          </div>
        </body>
        </html>
      `;

      if (order.customers?.email) {
        const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
        await fetch(emailApiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: order.customers.email,
            subject: `Order Updated - Approval Needed - Order #${order.id.slice(0, 8).toUpperCase()}`,
            html: emailHtml,
          }),
        });
      }

      if (order.customers?.phone) {
        let smsMessage =
          `Hi ${order.customers.first_name}, we've updated your Bounce Party Club booking ` +
          `(Order #${order.id.slice(0, 8).toUpperCase()}).`;

        if (adminMessage.trim()) {
          smsMessage += ` Note: ${adminMessage.trim()}`;
        }

        smsMessage += ` Please review and approve: ${customerPortalUrl}`;

        await sendSMS(smsMessage);
      }
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  }

  async function sendSMS(message: string) {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
    await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: order.customers?.phone,
        message,
        orderId: order.id,
      }),
    });
  }

  async function calculateDistance(origin: { lat: number; lng: number }, destination: string): Promise<number> {
    return new Promise((resolve) => {
      if (!window.google?.maps) {
        resolve(0);
        return;
      }

      const service = new google.maps.DistanceMatrixService();
      service.getDistanceMatrix(
        {
          origins: [new google.maps.LatLng(origin.lat, origin.lng)],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (response, status) => {
          if (status === 'OK' && response?.rows[0]?.elements[0]?.distance) {
            const distanceInMeters = response.rows[0].elements[0].distance.value;
            resolve(distanceInMeters / 1609.34);
          } else {
            resolve(0);
          }
        }
      );
    });
  }

  async function handleAddDiscount() {
    if (!newDiscount.name.trim()) {
      alert('Please enter a discount name');
      return;
    }

    const amount = parseFloat(discountAmountInput) * 100;
    const percentage = parseFloat(discountPercentInput);

    if (amount === 0 && percentage === 0) {
      alert('Please enter either an amount or percentage');
      return;
    }

    if (amount > 0 && percentage > 0) {
      alert('Please enter either amount OR percentage, not both');
      return;
    }

    // Save as template if checkbox is checked
    if (saveDiscountAsTemplate) {
      try {
        // Check if template with this name already exists
        const { data: existing } = await supabase
          .from('saved_discount_templates')
          .select('id')
          .eq('name', newDiscount.name)
          .maybeSingle();

        if (existing) {
          alert(`A discount template with the name "${newDiscount.name}" already exists. Please choose a different name or update the existing template.`);
          return;
        }

        await supabase.from('saved_discount_templates').insert({
          name: newDiscount.name,
          amount_cents: Math.round(amount),
          percentage: percentage || 0,
        });
        await loadSavedTemplates();
      } catch (error) {
        console.error('Error saving discount template:', error);
        alert('Failed to save discount template');
        return;
      }
    }

    // Add discount to staging array (not saved to DB yet)
    const newDiscountItem = {
      id: `temp_${Date.now()}`,
      order_id: order.id,
      name: newDiscount.name,
      amount_cents: Math.round(amount),
      percentage: percentage || 0,
      is_new: true,
    };

    setDiscounts([...discounts, newDiscountItem]);
    setNewDiscount({ name: '', amount_cents: 0, percentage: 0 });
    setDiscountAmountInput('0.00');
    setDiscountPercentInput('0');
    setSaveDiscountAsTemplate(false);
    setHasChanges(true);
  }

  function handleRemoveDiscount(discountId: string) {
    if (!confirm('Remove this discount?')) return;

    // Remove from staging array (not saved to DB yet)
    setDiscounts(discounts.filter(d => d.id !== discountId));
    setHasChanges(true);
  }

  async function handleAddCustomFee() {
    if (!newCustomFee.name.trim()) {
      alert('Please enter a fee name');
      return;
    }

    const amount = parseFloat(customFeeInput) * 100;

    if (amount <= 0) {
      alert('Please enter a valid fee amount');
      return;
    }

    // Save as template if checkbox is checked
    if (saveFeeAsTemplate) {
      try {
        // Check if template with this name already exists
        const { data: existing } = await supabase
          .from('saved_fee_templates')
          .select('id')
          .eq('name', newCustomFee.name)
          .maybeSingle();

        if (existing) {
          alert(`A fee template with the name "${newCustomFee.name}" already exists. Please choose a different name or update the existing template.`);
          return;
        }

        await supabase.from('saved_fee_templates').insert({
          name: newCustomFee.name,
          amount_cents: Math.round(amount),
        });
        await loadSavedTemplates();
      } catch (error) {
        console.error('Error saving fee template:', error);
        alert('Failed to save fee template');
        return;
      }
    }

    // Add custom fee to staging array (not saved to DB yet)
    const newFeeItem = {
      id: `temp_${Date.now()}`,
      order_id: order.id,
      name: newCustomFee.name,
      amount_cents: Math.round(amount),
      is_new: true,
    };

    setCustomFees([...customFees, newFeeItem]);
    setNewCustomFee({ name: '', amount_cents: 0 });
    setCustomFeeInput('0.00');
    setSaveFeeAsTemplate(false);
    setHasChanges(true);
  }

  function handleRemoveCustomFee(feeId: string) {
    if (!confirm('Remove this fee?')) return;

    // Remove from staging array (not saved to DB yet)
    setCustomFees(customFees.filter(f => f.id !== feeId));
    setHasChanges(true);
  }

  async function handleDeleteDiscountTemplate() {
    if (!selectedDiscountTemplateId) {
      alert('Please select a discount template first');
      return;
    }

    const template = savedDiscountTemplates.find(t => t.id === selectedDiscountTemplateId);
    if (!confirm(`Delete the discount template "${template?.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('saved_discount_templates')
        .delete()
        .eq('id', selectedDiscountTemplateId);

      if (error) throw error;

      setSelectedDiscountTemplateId('');
      await loadSavedTemplates();
      alert('Discount template deleted successfully');
    } catch (error) {
      console.error('Error deleting discount template:', error);
      alert('Failed to delete discount template');
    }
  }

  async function handleDeleteFeeTemplate() {
    if (!selectedFeeTemplateId) {
      alert('Please select a fee template first');
      return;
    }

    const template = savedFeeTemplates.find(t => t.id === selectedFeeTemplateId);
    if (!confirm(`Delete the fee template "${template?.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('saved_fee_templates')
        .delete()
        .eq('id', selectedFeeTemplateId);

      if (error) throw error;

      setSelectedFeeTemplateId('');
      await loadSavedTemplates();
      alert('Fee template deleted successfully');
    } catch (error) {
      console.error('Error deleting fee template:', error);
      alert('Failed to delete fee template');
    }
  }

  function initiateStatusChange(newStatus: string) {
    setPendingStatus(newStatus);
    setStatusChangeReason('');
    setShowStatusDialog(true);
  }

  async function confirmStatusChange() {
    if (!statusChangeReason.trim()) {
      alert('Please provide a reason for the status change');
      return;
    }

    try {
      // Check availability if confirming the order
      if (pendingStatus === 'confirmed') {
        const activeItems = stagedItems.filter(item => !item.is_deleted);
        const checks = activeItems.map(item => ({
          unitId: item.unit_id,
          wetOrDry: item.wet_or_dry,
          quantity: item.qty,
          eventStartDate: editedOrder.event_date,
          eventEndDate: editedOrder.event_end_date,
          excludeOrderId: order.id,
        }));

        const availabilityResults = await checkMultipleUnitsAvailability(checks);
        const conflicts = availabilityResults.filter(result => !result.isAvailable);

        if (conflicts.length > 0) {
          const conflictList = conflicts
            .map(c => {
              const item = activeItems.find(i => i.unit_id === c.unitId);
              return item?.unit_name || 'Unknown unit';
            })
            .join(', ');

          alert(
            `Cannot confirm order: The following equipment is not available for the selected dates: ${conflictList}\n\n` +
            'Please adjust the order dates or equipment before confirming.'
          );
          return;
        }
      }

      // Update order status
      const { error: updateError } = await supabase.from('orders').update({ status: pendingStatus }).eq('id', order.id);
      if (updateError) {
        console.error('Error updating order status:', updateError);
        throw new Error(`Failed to update order status: ${updateError.message}`);
      }

      // Get current user for logging
      const { data: { user } } = await supabase.auth.getUser();

      // Log status change in changelog with reason
      // Store reason in the new_value field in format: "status | Reason: reason text"
      const changeDescription = `${pendingStatus} | Reason: ${statusChangeReason}`;
      const { error: logError } = await supabase.from('order_changelog').insert({
        order_id: order.id,
        user_id: user?.id,
        field_changed: 'status',
        old_value: order.status,
        new_value: changeDescription,
        change_type: 'status_change',
      });

      if (logError) {
        console.error('Error logging status change:', logError);
        // Don't throw here - the status was already updated successfully
      }

      console.log('✅ Status changed from', order.status, 'to', pendingStatus, 'Reason:', statusChangeReason);

      setShowStatusDialog(false);
      setPendingStatus('');
      setStatusChangeReason('');
      await loadOrderDetails();
      onUpdate();
      alert('Status updated successfully!');
    } catch (error) {
      console.error('Error updating status:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to update status: ${errorMessage}`);
    }
  }

  const totalOrder = calculatedPricing?.total_cents || (order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents);
  const activeItems = stagedItems.filter(item => !item.is_deleted);

  // Filter available units - only show units that:
  // 1. Are not already in the order, OR
  // 2. Have quantity_available > 1 (meaning we can add more)
  const unitsAvailableToAdd = availableUnits.filter(unit => {
    // Check if this unit is already in the order (not deleted)
    const existingItem = activeItems.find(item => item.unit_id === unit.id);

    if (!existingItem) {
      // Unit not in order, so it's available to add
      return true;
    }

    // Unit is in order - only show if we have multiple units in inventory
    return (unit.quantity_available || 1) > 1;
  });

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
              <option value="notes">Notes</option>
              <option value="changelog">Changelog</option>
            </select>
          </div>

          {/* Desktop Tabs */}
          <div className="hidden md:flex space-x-1">
            {(['details', 'workflow', 'notes', 'changelog'] as const).map(section => (
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
                {section === 'notes' && <MessageSquare className="w-4 h-4 inline mr-2" />}
                {section === 'changelog' && <History className="w-4 h-4 inline mr-2" />}
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 md:px-6 py-4 md:py-6 max-h-[calc(100vh-200px)] md:max-h-[calc(100vh-300px)] overflow-y-auto">
          {activeSection === 'details' && (
            <div className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Edit2 className="w-4 h-4 text-amber-700" />
                  <h3 className="font-semibold text-amber-900">Edit Mode Active</h3>
                </div>
                <p className="text-sm text-amber-700">
                  Make changes to order details and items below. Click "Save Changes" to apply all changes at once.
                  The order status will be set to "Awaiting Customer Approval" when saved.
                </p>
              </div>

              {checkingAvailability && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
                    <p className="text-sm text-blue-700">Checking unit availability...</p>
                  </div>
                </div>
              )}

              {!checkingAvailability && availabilityIssues.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-700" />
                    <h3 className="font-semibold text-red-900">Availability Conflict</h3>
                  </div>
                  <p className="text-sm text-red-700 mb-2">
                    The following units are not available for the selected dates:
                  </p>
                  <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                    {availabilityIssues.map((issue, idx) => (
                      <li key={idx}>
                        <span className="font-medium">{issue.unitName}</span>
                        {issue.conflicts && issue.conflicts.length > 0 && (
                          <span className="text-xs">
                            {' '}(conflicts with {issue.conflicts.length} other order{issue.conflicts.length > 1 ? 's' : ''})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-600 mt-2">
                    Please adjust the dates or remove the conflicting items before saving.
                  </p>
                </div>
              )}

              {(() => {
                const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);
                const finalDepositCents = customDepositCents !== null ? customDepositCents : (calculatedPricing?.deposit_due_cents || order.deposit_due_cents);
                const currentPaidAmount = order.stripe_amount_paid_cents || 0;
                const originalTotal = order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;
                const newTotal = calculatedPricing?.total_cents || originalTotal;

                const willClearPayment = itemsChanged ||
                  (order.stripe_payment_intent_id && (
                    finalDepositCents > currentPaidAmount ||
                    (currentPaidAmount >= originalTotal && newTotal > currentPaidAmount)
                  ));

                return willClearPayment && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-purple-700" />
                      <h3 className="font-semibold text-purple-900">Payment Information Will Be Cleared</h3>
                    </div>
                    <p className="text-sm text-purple-700 mb-2">
                      {itemsChanged
                        ? "Since you're adding or removing units, the saved payment method will be cleared."
                        : finalDepositCents > currentPaidAmount
                        ? `The new deposit (${formatCurrency(finalDepositCents)}) is higher than the amount already paid (${formatCurrency(currentPaidAmount)}), so the payment method will be cleared.`
                        : `The customer paid the full amount (${formatCurrency(currentPaidAmount)}), but the new total (${formatCurrency(newTotal)}) exceeds this, so the payment method will be cleared.`
                      }
                    </p>
                    <p className="text-xs text-purple-600">
                      The customer will be asked to provide payment information again when they approve the changes.
                    </p>
                  </div>
                );
              })()}

              {!checkingAvailability && availabilityIssues.length === 0 && stagedItems.filter(i => !i.is_deleted).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-700" />
                    <p className="text-sm text-green-700 font-medium">All units are available for the selected dates</p>
                  </div>
                </div>
              )}

              {/* EVENT DETAILS SECTION */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-4">Event Details</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Event Start Date</label>
                      <input
                        type="date"
                        value={editedOrder.event_date}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          setEditedOrder({
                            ...editedOrder,
                            event_date: newStart,
                            event_end_date: newStart > editedOrder.event_end_date ? newStart : editedOrder.event_end_date
                          });
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Event End Date</label>
                      <input
                        type="date"
                        value={editedOrder.event_end_date}
                        onChange={(e) => setEditedOrder({ ...editedOrder, event_end_date: e.target.value })}
                        min={editedOrder.event_date}
                        disabled={editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial'}
                        className="w-full px-3 py-2 border border-slate-300 rounded disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                  {(editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial') && (
                    <p className="text-xs text-slate-500">Same-day events cannot span multiple days</p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>
                      <input
                        type="time"
                        value={editedOrder.start_window}
                        onChange={(e) => setEditedOrder({ ...editedOrder, start_window: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>
                      <input
                        type="time"
                        value={editedOrder.end_window}
                        onChange={(e) => setEditedOrder({ ...editedOrder, end_window: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Location Type</label>
                    <select
                      value={editedOrder.location_type}
                      onChange={(e) => {
                        const newType = e.target.value;
                        setEditedOrder({
                          ...editedOrder,
                          location_type: newType,
                          pickup_preference: newType === 'commercial' ? 'same_day' : editedOrder.pickup_preference
                        });
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded"
                    >
                      <option value="residential">Residential</option>
                      <option value="commercial">Commercial</option>
                    </select>
                  </div>
                </div>
              </div>

              {editedOrder.location_type === 'residential' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <label className="block text-sm font-medium text-slate-700 mb-3">Pickup Preference</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEditedOrder({ ...editedOrder, pickup_preference: 'next_day' })}
                      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                        editedOrder.pickup_preference === 'next_day'
                          ? 'border-green-600 bg-green-50'
                          : 'border-slate-300 hover:border-green-400'
                      }`}
                    >
                      <span className={`font-semibold text-center ${
                        editedOrder.pickup_preference === 'next_day' ? 'text-green-900' : 'text-slate-700'
                      }`}>
                        Next Morning
                      </span>
                      <span className="text-xs text-slate-600 text-center mt-1">Equipment stays overnight</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (editedOrder.event_date === editedOrder.event_end_date) {
                          setEditedOrder({ ...editedOrder, pickup_preference: 'same_day' });
                        }
                      }}
                      disabled={editedOrder.event_date !== editedOrder.event_end_date}
                      className={`flex flex-col items-center p-4 rounded-lg border-2 transition-all ${
                        editedOrder.pickup_preference === 'same_day'
                          ? 'border-orange-600 bg-orange-50'
                          : editedOrder.event_date !== editedOrder.event_end_date
                          ? 'border-slate-200 bg-slate-100 opacity-50 cursor-not-allowed'
                          : 'border-slate-300 hover:border-orange-400'
                      }`}
                    >
                      <span className={`font-semibold text-center ${
                        editedOrder.pickup_preference === 'same_day' ? 'text-orange-900' : 'text-slate-700'
                      }`}>
                        Same Day
                      </span>
                      <span className="text-xs text-slate-600 text-center mt-1">Pickup same evening</span>
                    </button>
                  </div>
                  {editedOrder.event_date !== editedOrder.event_end_date && (
                    <p className="text-xs text-amber-600 mt-3">
                      Multi-day rentals require next morning pickup
                    </p>
                  )}
                </div>
              )}

              {/* EVENT ADDRESS SECTION */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-4">Event Address</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label>
                    <AddressAutocomplete
                      value={editedOrder.address_line1}
                      onSelect={(result) => {
                        setEditedOrder({
                          ...editedOrder,
                          address_line1: result.street,
                          address_city: result.city,
                          address_state: result.state,
                          address_zip: result.zip,
                        });
                      }}
                      placeholder="Enter event address"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Address Line 2 (optional)</label>
                    <input
                      type="text"
                      value={editedOrder.address_line2}
                      onChange={(e) => setEditedOrder({ ...editedOrder, address_line2: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                      placeholder="Apt, Suite, Unit, etc."
                    />
                  </div>
                  <p className="text-xs text-amber-600">Address changes will recalculate travel fees when saved</p>
                </div>
              </div>

              {/* SETUP DETAILS SECTION */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-4">Setup Details</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Setup Surface</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditedOrder({ ...editedOrder, can_stake: true, surface: 'grass' })}
                        className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                          editedOrder.can_stake
                            ? 'border-green-600 bg-green-50 text-green-900'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-green-400'
                        }`}
                      >
                        Grass
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditedOrder({ ...editedOrder, can_stake: false, surface: 'cement' })}
                        className={`flex-1 px-3 py-2 border-2 rounded font-medium transition-all ${
                          !editedOrder.can_stake
                            ? 'border-orange-600 bg-orange-50 text-orange-900'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-orange-400'
                        }`}
                      >
                        Sandbags
                      </button>
                    </div>
                    {!editedOrder.can_stake && (
                      <p className="text-xs text-amber-600 mt-1">Sandbag fee ({formatCurrency(pricingRules?.surface_sandbag_fee_cents || 3000)}) will be applied</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Generators</label>
                    <input
                      type="number"
                      min="0"
                      value={editedOrder.generator_qty}
                      onChange={(e) => {
                        const qty = parseInt(e.target.value) || 0;
                        setEditedOrder({ ...editedOrder, generator_qty: qty });
                        setHasChanges(true);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded"
                    />
                    {editedOrder.generator_qty > 0 && pricingRules?.generator_price_cents && (
                      <p className="text-xs text-blue-600 mt-1">
                        {editedOrder.generator_qty} × {formatCurrency(pricingRules.generator_price_cents)} = {formatCurrency(editedOrder.generator_qty * pricingRules.generator_price_cents)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ORDER ITEMS SECTION */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-4">Order Items</h3>
                <div className="space-y-2">
                  {activeItems.map((item, index) => (
                    <div key={item.id || `${item.unit_id}-${item.wet_or_dry}-${index}`} className={`flex justify-between items-center rounded-lg p-3 ${item.is_new ? 'bg-green-50 border border-green-200' : 'bg-slate-50'}`}>
                      <div>
                        <p className="font-medium text-slate-900">
                          {item.unit_name}
                          {item.is_new && <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded">NEW</span>}
                        </p>
                        <p className="text-sm text-slate-600">{item.wet_or_dry === 'water' ? 'Water' : 'Dry'} • Qty: {item.qty}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold">{formatCurrency(item.unit_price_cents * item.qty)}</p>
                        <button
                          onClick={() => stageRemoveItem(item)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Add Item
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
                    {unitsAvailableToAdd.length > 0 ? (
                      unitsAvailableToAdd.map(unit => (
                        <div key={unit.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <p className="font-medium text-slate-900 mb-2">
                            {unit.name}
                            {(unit.quantity_available || 1) > 1 && (
                              <span className="ml-2 text-xs text-slate-600">({unit.quantity_available} available)</span>
                            )}
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => stageAddItem(unit, 'dry')}
                              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded"
                            >
                              Add Dry ({formatCurrency(unit.price_dry_cents)})
                            </button>
                            {unit.price_water_cents && (
                              <button
                                onClick={() => stageAddItem(unit, 'water')}
                                className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-2 px-3 rounded"
                              >
                                Add Water ({formatCurrency(unit.price_water_cents)})
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 text-center py-6 text-slate-500">
                        All available units have been added to this order
                      </div>
                    )}
                  </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Current/Original Pricing */}
                {currentOrderSummary && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg">
                    <OrderSummary
                      summary={currentOrderSummary}
                      title="Current Pricing"
                      showDeposit={true}
                      showTip={order.tip_cents > 0}
                    />
                  </div>
                )}

                {/* Updated Pricing */}
                {updatedOrderSummary && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg">
                    <OrderSummary
                      summary={updatedOrderSummary}
                      title={
                        <>
                          Updated Pricing
                          {hasChanges && <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded whitespace-nowrap">Changes Pending</span>}
                        </>
                      }
                      showDeposit={true}
                      showTip={order.tip_cents > 0}
                      highlightNewItems={true}
                      comparisonTotal={currentOrderSummary?.total}
                      customDepositCents={customDepositCents}
                    />
                  </div>
                )}
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Discounts</h3>

                {discounts.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {discounts.map(discount => (
                      <div key={discount.id} className="flex justify-between items-center bg-white rounded p-2">
                        <div>
                          <p className="font-medium text-sm">{discount.name}</p>
                          <p className="text-xs text-slate-600">
                            {discount.amount_cents > 0 ? formatCurrency(discount.amount_cents) : `${discount.percentage}%`}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveDiscount(discount.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {savedDiscountTemplates.length > 0 && (
                    <div>
                      <label className="block text-xs text-slate-700 mb-1 font-medium">Load Saved Discount</label>
                      <div className="flex gap-2">
                        <select
                          value={selectedDiscountTemplateId}
                          onChange={(e) => {
                            setSelectedDiscountTemplateId(e.target.value);
                            const template = savedDiscountTemplates.find(t => t.id === e.target.value);
                            if (template) {
                              setNewDiscount({ name: template.name, amount_cents: template.amount_cents, percentage: template.percentage });
                              setDiscountAmountInput((template.amount_cents / 100).toFixed(2));
                              setDiscountPercentInput(template.percentage.toString());
                            }
                          }}
                          className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
                        >
                          <option value="">Select a saved discount...</option>
                          {savedDiscountTemplates.map(template => (
                            <option key={template.id} value={template.id}>
                              {template.name} - {template.amount_cents > 0 ? `$${(template.amount_cents / 100).toFixed(2)}` : `${template.percentage}%`}
                            </option>
                          ))}
                        </select>
                        {selectedDiscountTemplateId && (
                          <button
                            onClick={handleDeleteDiscountTemplate}
                            className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 text-sm"
                            title="Delete selected template"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <input
                    type="text"
                    value={newDiscount.name}
                    onChange={(e) => setNewDiscount({ ...newDiscount, name: e.target.value })}
                    placeholder="Discount name"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-700 mb-1 font-medium">$ Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={discountAmountInput}
                          onChange={(e) => {
                            setDiscountAmountInput(e.target.value);
                            if (parseFloat(e.target.value) > 0) {
                              setDiscountPercentInput('0');
                            }
                          }}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-700 mb-1 font-medium">% Percentage</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="1"
                          value={discountPercentInput}
                          onChange={(e) => {
                            setDiscountPercentInput(e.target.value);
                            if (parseFloat(e.target.value) > 0) {
                              setDiscountAmountInput('0.00');
                            }
                          }}
                          placeholder="0"
                          className="w-full pr-7 pl-3 py-2 border border-slate-300 rounded text-sm"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">%</span>
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={saveDiscountAsTemplate}
                      onChange={(e) => setSaveDiscountAsTemplate(e.target.checked)}
                      className="rounded"
                    />
                    Save this discount for future use
                  </label>
                  <button
                    onClick={handleAddDiscount}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm font-medium"
                  >
                    Add Discount
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Custom Fees</h3>

                {customFees.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {customFees.map(fee => (
                      <div key={fee.id} className="flex justify-between items-center bg-white rounded p-2">
                        <div>
                          <p className="font-medium text-sm">{fee.name}</p>
                          <p className="text-xs text-slate-600">
                            {formatCurrency(fee.amount_cents)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveCustomFee(fee.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {savedFeeTemplates.length > 0 && (
                    <div>
                      <label className="block text-xs text-slate-700 mb-1 font-medium">Load Saved Fee</label>
                      <div className="flex gap-2">
                        <select
                          value={selectedFeeTemplateId}
                          onChange={(e) => {
                            setSelectedFeeTemplateId(e.target.value);
                            const template = savedFeeTemplates.find(t => t.id === e.target.value);
                            if (template) {
                              setNewCustomFee({ name: template.name, amount_cents: template.amount_cents });
                              setCustomFeeInput((template.amount_cents / 100).toFixed(2));
                            }
                          }}
                          className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm"
                        >
                          <option value="">Select a saved fee...</option>
                          {savedFeeTemplates.map(template => (
                            <option key={template.id} value={template.id}>
                              {template.name} - ${(template.amount_cents / 100).toFixed(2)}
                            </option>
                          ))}
                        </select>
                        {selectedFeeTemplateId && (
                          <button
                            onClick={handleDeleteFeeTemplate}
                            className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 text-sm"
                            title="Delete selected template"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <input
                    type="text"
                    value={newCustomFee.name}
                    onChange={(e) => setNewCustomFee({ ...newCustomFee, name: e.target.value })}
                    placeholder="Fee name (e.g., Tip, Setup Fee, etc.)"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                  />
                  <div>
                    <label className="block text-xs text-slate-700 mb-1 font-medium">$ Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={customFeeInput}
                        onChange={(e) => setCustomFeeInput(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded text-sm"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={saveFeeAsTemplate}
                      onChange={(e) => setSaveFeeAsTemplate(e.target.checked)}
                      className="rounded"
                    />
                    Save this fee for future use
                  </label>
                  <button
                    onClick={handleAddCustomFee}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm font-medium"
                  >
                    Add Custom Fee
                  </button>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Deposit Override</h3>
                <p className="text-sm text-slate-600 mb-3">
                  Set a custom deposit amount. Use this when the calculated deposit doesn't match your requirements.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700">Calculated Deposit:</span>
                    <span className="font-semibold">{formatCurrency(calculatedPricing?.deposit_due_cents || order.deposit_due_cents)}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-slate-600 mb-1">Custom Deposit Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        value={customDepositInput}
                        onChange={(e) => setCustomDepositInput(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        onClick={() => {
                          const inputValue = customDepositInput.trim();
                          if (inputValue === '') {
                            alert('Please enter a deposit amount');
                            return;
                          }
                          const amountCents = Math.round(parseFloat(inputValue) * 100);
                          if (isNaN(amountCents) || amountCents < 0) {
                            alert('Please enter a valid deposit amount');
                            return;
                          }
                          setCustomDepositCents(amountCents);
                          setHasChanges(true);
                        }}
                        className="bg-amber-600 hover:bg-amber-700 text-white py-2 px-4 rounded text-sm font-medium"
                      >
                        Apply
                      </button>
                      {customDepositCents !== null && (
                        <button
                          onClick={() => {
                            setCustomDepositCents(null);
                            setCustomDepositInput('');
                            setHasChanges(true);
                          }}
                          className="bg-slate-500 hover:bg-slate-600 text-white py-2 px-4 rounded text-sm font-medium"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {customDepositCents !== null && (
                    <div className="bg-white border border-amber-300 rounded p-3">
                      <p className="text-sm font-medium text-amber-800 mb-1">Active Override</p>
                      <p className="text-xs text-slate-600">
                        Deposit will be set to <span className="font-semibold">{formatCurrency(customDepositCents)}</span> when you save changes.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Message to Customer</h3>
                <p className="text-sm text-slate-600 mb-3">
                  Add an optional message to explain the changes to the customer. This will be included in the email and text notification.
                </p>
                <textarea
                  value={adminMessage}
                  onChange={(e) => {
                    setAdminMessage(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="Example: We're upgrading your bounce house to a larger unit at no extra charge! Also added a generator since your event location doesn't have power outlets nearby."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm resize-none"
                />
                {adminMessage.trim() && (
                  <p className="text-xs text-purple-600 mt-2">
                    This message will be sent to the customer when you save changes.
                  </p>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Order Status</h3>
                <div className="flex flex-wrap gap-2">
                  {['pending', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'].map(status => (
                    <button
                      key={status}
                      onClick={() => initiateStatusChange(status)}
                      className={`px-3 py-1 rounded text-sm font-medium ${
                        order.status === status
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {status.replace(/_/g, ' ').toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          )}

          {activeSection === 'workflow' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900">Workflow Events</h3>
              {workflowEvents.length === 0 ? (
                <p className="text-slate-600">No workflow events yet</p>
              ) : (
                <div className="space-y-2">
                  {workflowEvents.map(event => (
                    <div key={event.id} className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <p className="font-medium text-sm">{event.event_type}</p>
                        <span className="text-xs text-slate-500 ml-auto">
                          {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      {event.description && (
                        <p className="text-sm text-slate-600 ml-6">{event.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === 'notes' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Add Note</h3>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded mb-2 h-24"
                  placeholder="Enter note..."
                />
                <button
                  onClick={handleAddNote}
                  disabled={savingNote || !newNote.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
                >
                  {savingNote ? 'Saving...' : 'Add Note'}
                </button>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Notes History</h3>
                {notes.length === 0 ? (
                  <p className="text-slate-600">No notes yet</p>
                ) : (
                  <div className="space-y-2">
                    {notes.map(note => (
                      <div key={note.id} className="bg-slate-50 rounded-lg p-3">
                        <p className="text-sm mb-2">{note.note}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{note.user?.email}</span>
                          <span>•</span>
                          <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'changelog' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900">Change History</h3>
              {changelog.length === 0 ? (
                <p className="text-slate-600">No changes recorded yet</p>
              ) : (
                <div className="space-y-2">
                  {changelog.map(change => (
                    <div key={change.id} className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <History className="w-4 h-4 text-blue-600" />
                        <p className="font-medium text-sm">{change.field_name}</p>
                        <span className="text-xs text-slate-500 ml-auto">
                          {format(new Date(change.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <div className="ml-6 text-sm">
                        <p className="text-slate-600">
                          <span className="text-red-600 line-through">{change.old_value || '(empty)'}</span>
                          {' → '}
                          <span className="text-green-600 font-medium">{change.new_value || '(empty)'}</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{change.user?.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status Change Confirmation Dialog */}
      {showStatusDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Confirm Status Change</h3>
            <p className="text-slate-700 mb-4">
              You are changing the order status to <span className="font-semibold">{pendingStatus.replace('_', ' ').toUpperCase()}</span>.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reason for status change <span className="text-red-600">*</span>
              </label>
              <textarea
                value={statusChangeReason}
                onChange={(e) => setStatusChangeReason(e.target.value)}
                placeholder="Example: Customer called to confirm. Payment received. Equipment ready for delivery."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm resize-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowStatusDialog(false);
                  setPendingStatus('');
                  setStatusChangeReason('');
                }}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmStatusChange}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
              >
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
