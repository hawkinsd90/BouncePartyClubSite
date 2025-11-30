import { useState, useEffect } from 'react';
import { X, Truck, MapPin, CheckCircle, MessageSquare, FileText, Edit2, History, Save, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { formatCurrency } from '../lib/pricing';
import { AddressAutocomplete } from './AddressAutocomplete';
import { checkMultipleUnitsAvailability } from '../lib/availability';

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
    event_date: order.event_date,
    event_end_date: order.event_end_date || order.event_date,
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
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [pricingRules, setPricingRules] = useState<any>(null);
  const [adminSettings, setAdminSettings] = useState<any>(null);
  const [calculatedPricing, setCalculatedPricing] = useState<any>(null);
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  useEffect(() => {
    loadOrderDetails();
    loadPricingData();
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

  // Recalculate pricing whenever staged items or order details change
  useEffect(() => {
    if (pricingRules && adminSettings && stagedItems.length > 0) {
      recalculatePricing();
    }
  }, [stagedItems, editedOrder, pricingRules, adminSettings]);

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
      // Calculate subtotal from staged items (excluding deleted)
      const activeItems = stagedItems.filter(item => !item.is_deleted);
      let subtotal_cents = activeItems.reduce((sum, item) => {
        return sum + (item.unit_price_cents * item.qty);
      }, 0);

      // Apply location multiplier
      const location_multiplier = editedOrder.location_type === 'residential'
        ? parseFloat(pricingRules.residential_multiplier)
        : parseFloat(pricingRules.commercial_multiplier);
      subtotal_cents = Math.round(subtotal_cents * location_multiplier);

      // Calculate travel fee if address changed
      let travel_fee_cents = order.travel_fee_cents;
      let distance_miles = order.distance_miles;

      const addressChanged =
        editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
        editedOrder.address_city !== (order.addresses?.city || '') ||
        editedOrder.address_state !== (order.addresses?.state || '') ||
        editedOrder.address_zip !== (order.addresses?.zip || '');

      if (addressChanged && editedOrder.address_line1 && editedOrder.address_city) {
        const homeBase = {
          lat: parseFloat(adminSettings.home_base_lat || '42.2808'),
          lng: parseFloat(adminSettings.home_base_lng || '-83.3863')
        };
        const destination = `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`;

        distance_miles = await calculateDistance(homeBase, destination);
        travel_fee_cents = calculateTravelFee(distance_miles, pricingRules);
      }

      // Calculate surface fee
      let surface_fee_cents = 0;
      if (editedOrder.surface === 'cement' || editedOrder.surface === 'asphalt' || editedOrder.surface === 'concrete') {
        surface_fee_cents = pricingRules.surface_sandbag_fee_cents || 3000;
      }

      // Calculate same day pickup fee
      let same_day_pickup_fee_cents = 0;
      const needs_same_day = editedOrder.location_type === 'commercial' || editedOrder.pickup_preference === 'same_day';
      if (needs_same_day && pricingRules.same_day_matrix_json) {
        const total_units = activeItems.reduce((sum, item) => sum + item.qty, 0);
        const has_generator = editedOrder.generator_qty > 0;

        const applicable_rules = pricingRules.same_day_matrix_json
          .filter((rule: any) => {
            if (rule.units > total_units) return false;
            if (rule.generator && !has_generator) return false;
            if (rule.subtotal_ge_cents > subtotal_cents) return false;
            return true;
          })
          .sort((a: any, b: any) => {
            if (a.units !== b.units) return b.units - a.units;
            if (a.generator !== b.generator) return a.generator ? -1 : 1;
            return b.subtotal_ge_cents - a.subtotal_ge_cents;
          });

        if (applicable_rules && applicable_rules.length > 0) {
          same_day_pickup_fee_cents = applicable_rules[0].fee_cents;
        }
      }

      // Calculate tax
      const tax_cents = Math.round((subtotal_cents + travel_fee_cents + surface_fee_cents) * 0.06);

      // Calculate totals
      const total_cents = subtotal_cents + travel_fee_cents + surface_fee_cents + same_day_pickup_fee_cents + tax_cents;
      const deposit_due_cents = activeItems.reduce((sum, item) => sum + item.qty, 0) * 5000;
      const balance_due_cents = total_cents - deposit_due_cents;

      setCalculatedPricing({
        subtotal_cents,
        travel_fee_cents,
        distance_miles,
        surface_fee_cents,
        same_day_pickup_fee_cents,
        tax_cents,
        total_cents,
        deposit_due_cents,
        balance_due_cents,
      });
    } catch (error) {
      console.error('Error recalculating pricing:', error);
    }
  }

  async function loadOrderDetails() {
    try {
      const [itemsRes, notesRes, eventsRes, changelogRes, unitsRes, discountsRes] = await Promise.all([
        supabase.from('order_items').select('*, units(name, price_dry_cents, price_water_cents)').eq('order_id', order.id),
        supabase.from('order_notes').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_workflow_events').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_changelog').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('units').select('*').eq('active', true).order('name'),
        supabase.from('order_discounts').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
      ]);

      if (itemsRes.data) setOrderItems(itemsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (eventsRes.data) setWorkflowEvents(eventsRes.data);
      if (changelogRes.data) setChangelog(changelogRes.data);
      if (unitsRes.data) setAvailableUnits(unitsRes.data);
      if (discountsRes.data) setDiscounts(discountsRes.data);
    } catch (error) {
      console.error('Error loading order details:', error);
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
        field_name: field,
        old_value: String(oldValue),
        new_value: String(newValue),
        action,
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

  function stageRemoveItem(index: number) {
    const updatedItems = [...stagedItems];
    if (updatedItems[index].is_new) {
      // Remove new items entirely
      updatedItems.splice(index, 1);
    } else {
      // Mark existing items as deleted
      updatedItems[index].is_deleted = true;
    }
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
      if (editedOrder.event_date !== order.event_date) {
        changes.event_date = editedOrder.event_date;
        changes.start_date = editedOrder.event_date; // Keep start_date in sync
        logs.push(['event_date', order.event_date, editedOrder.event_date]);
      }
      if (editedOrder.event_end_date !== (order.event_end_date || order.event_date)) {
        changes.event_end_date = editedOrder.event_end_date;
        changes.end_date = editedOrder.event_end_date; // Keep end_date in sync
        logs.push(['event_end_date', order.event_end_date || order.event_date, editedOrder.event_end_date]);
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
          `${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state}`,
          `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state}`
        ]);
      }

      // Apply calculated pricing
      if (calculatedPricing) {
        changes.subtotal_cents = calculatedPricing.subtotal_cents;
        changes.travel_fee_cents = calculatedPricing.travel_fee_cents;
        changes.distance_miles = calculatedPricing.distance_miles;
        changes.surface_fee_cents = calculatedPricing.surface_fee_cents;
        changes.same_day_pickup_fee_cents = calculatedPricing.same_day_pickup_fee_cents;
        changes.tax_cents = calculatedPricing.tax_cents;
        changes.deposit_due_cents = calculatedPricing.deposit_due_cents;
        changes.balance_due_cents = calculatedPricing.balance_due_cents;

        if (calculatedPricing.travel_fee_cents !== order.travel_fee_cents) {
          logs.push(['travel_fee', order.travel_fee_cents, calculatedPricing.travel_fee_cents]);
        }
        if (calculatedPricing.surface_fee_cents !== order.surface_fee_cents) {
          logs.push(['surface_fee', order.surface_fee_cents, calculatedPricing.surface_fee_cents]);
        }
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

      // Set status to awaiting customer approval
      changes.status = 'awaiting_customer_approval';

      // Update order
      if (Object.keys(changes).length > 0) {
        await supabase.from('orders').update(changes).eq('id', order.id);

        // Log all changes
        for (const [field, oldVal, newVal] of logs) {
          await logChange(field, oldVal, newVal);
        }

        await sendOrderEditNotifications();
      }

      await loadOrderDetails();
      onUpdate();
      alert('Changes saved successfully! Customer will be notified to review and approve the changes.');
      onClose();
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('Failed to save changes');
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
        const smsMessage =
          `Hi ${order.customers.first_name}, we've updated your Bounce Party Club booking ` +
          `(Order #${order.id.slice(0, 8).toUpperCase()}). Please review and approve the changes: ${customerPortalUrl}`;

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

  function calculateTravelFee(distance: number, rules: any): number {
    const base_radius = parseFloat(rules.base_radius_miles) || 20;
    const per_mile = rules.per_mile_after_base_cents || 500;

    if (distance <= base_radius) return 0;

    const chargeableMiles = distance - base_radius;
    return Math.round(chargeableMiles * per_mile);
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

    try {
      const { error } = await supabase.from('order_discounts').insert({
        order_id: order.id,
        name: newDiscount.name,
        amount_cents: Math.round(amount),
        percentage: percentage || 0,
      });

      if (error) throw error;

      setNewDiscount({ name: '', amount_cents: 0, percentage: 0 });
      setDiscountAmountInput('0.00');
      setDiscountPercentInput('0');
      await loadOrderDetails();
    } catch (error) {
      console.error('Error adding discount:', error);
      alert('Failed to add discount');
    }
  }

  async function handleRemoveDiscount(discountId: string) {
    if (!confirm('Remove this discount?')) return;

    try {
      await supabase.from('order_discounts').delete().eq('id', discountId);
      await loadOrderDetails();
    } catch (error) {
      console.error('Error removing discount:', error);
      alert('Failed to remove discount');
    }
  }

  async function handleStatusChange(newStatus: string) {
    try {
      const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', order.id);
      if (error) throw error;

      await supabase.from('order_workflow_events').insert({
        order_id: order.id,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        event_type: newStatus,
        description: `Order status changed to ${newStatus}`,
      });

      await loadOrderDetails();
      onUpdate();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update status');
    }
  }

  const totalOrder = calculatedPricing?.total_cents || (order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents);
  const activeItems = stagedItems.filter(item => !item.is_deleted);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-6xl w-full my-8">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-lg z-10">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="text-sm text-slate-600">
              {order.customers?.first_name} {order.customers?.last_name} • {format(new Date(order.event_date), 'MMM d, yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={handleSaveChanges}
                disabled={saving}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex space-x-1">
            {(['details', 'workflow', 'notes', 'changelog'] as const).map(section => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 font-medium rounded-t-lg ${
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

        <div className="px-6 py-6 max-h-[calc(100vh-300px)] overflow-y-auto">
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

              {!checkingAvailability && availabilityIssues.length === 0 && stagedItems.filter(i => !i.is_deleted).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-700" />
                    <p className="text-sm text-green-700 font-medium">All units are available for the selected dates</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
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
                  {(editedOrder.pickup_preference === 'same_day' || editedOrder.location_type === 'commercial') && (
                    <p className="text-xs text-slate-500 mt-1">Same-day events cannot span multiple days</p>
                  )}
                </div>

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

              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Event Address</h3>
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

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900">Order Items</h3>
                </div>
                <div className="space-y-2">
                  {activeItems.map((item, index) => (
                    <div key={index} className={`flex justify-between items-center rounded-lg p-3 ${item.is_new ? 'bg-green-50 border border-green-200' : 'bg-slate-50'}`}>
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
                          onClick={() => stageRemoveItem(stagedItems.indexOf(item))}
                          className="text-red-600 hover:text-red-800 p-1"
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
                    {availableUnits.map(unit => (
                      <div key={unit.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <p className="font-medium text-slate-900 mb-2">{unit.name}</p>
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
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Current/Original Pricing */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Current Pricing</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal:</span>
                      <span className="font-medium">{formatCurrency(order.subtotal_cents)}</span>
                    </div>
                    {order.travel_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Travel Fee:</span>
                        <span className="font-medium">{formatCurrency(order.travel_fee_cents)}</span>
                      </div>
                    )}
                    {order.surface_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Surface Fee:</span>
                        <span className="font-medium">{formatCurrency(order.surface_fee_cents)}</span>
                      </div>
                    )}
                    {order.same_day_pickup_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Same Day Pickup:</span>
                        <span className="font-medium">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Tax (6%):</span>
                      <span className="font-medium">{formatCurrency(order.tax_cents)}</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold border-t border-slate-300 pt-2">
                      <span>Total:</span>
                      <span>{formatCurrency(order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-700">
                      <span>Deposit Due:</span>
                      <span className="font-semibold">{formatCurrency(order.deposit_due_cents)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Balance Due:</span>
                      <span className="font-medium">{formatCurrency(order.balance_due_cents)}</span>
                    </div>
                  </div>
                </div>

                {/* Updated Pricing */}
                {calculatedPricing && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      Updated Pricing
                      {hasChanges && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Changes Pending</span>}
                    </h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Subtotal:</span>
                        <div className="flex items-center gap-2">
                          {calculatedPricing.subtotal_cents !== order.subtotal_cents && (
                            <span className="text-xs text-slate-400 line-through">{formatCurrency(order.subtotal_cents)}</span>
                          )}
                          <span className={`font-medium ${calculatedPricing.subtotal_cents !== order.subtotal_cents ? 'text-blue-700' : ''}`}>
                            {formatCurrency(calculatedPricing.subtotal_cents)}
                          </span>
                        </div>
                      </div>
                      {calculatedPricing.travel_fee_cents > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Travel Fee ({calculatedPricing.distance_miles?.toFixed(1)} mi):</span>
                          <div className="flex items-center gap-2">
                            {calculatedPricing.travel_fee_cents !== order.travel_fee_cents && (
                              <span className="text-xs text-slate-400 line-through">{formatCurrency(order.travel_fee_cents)}</span>
                            )}
                            <span className={`font-medium ${calculatedPricing.travel_fee_cents !== order.travel_fee_cents ? 'text-blue-700' : ''}`}>
                              {formatCurrency(calculatedPricing.travel_fee_cents)}
                            </span>
                          </div>
                      </div>
                    )}
                    {calculatedPricing.surface_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Surface Fee (Sandbags):</span>
                        <div className="flex items-center gap-2">
                          {calculatedPricing.surface_fee_cents !== order.surface_fee_cents && (
                            <span className="text-xs text-slate-400 line-through">{formatCurrency(order.surface_fee_cents)}</span>
                          )}
                          <span className={`font-medium ${calculatedPricing.surface_fee_cents !== order.surface_fee_cents ? 'text-blue-700' : ''}`}>
                            {formatCurrency(calculatedPricing.surface_fee_cents)}
                          </span>
                        </div>
                      </div>
                    )}
                    {calculatedPricing.same_day_pickup_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Same Day Pickup:</span>
                        <div className="flex items-center gap-2">
                          {calculatedPricing.same_day_pickup_fee_cents !== order.same_day_pickup_fee_cents && (
                            <span className="text-xs text-slate-400 line-through">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                          )}
                          <span className={`font-medium ${calculatedPricing.same_day_pickup_fee_cents !== order.same_day_pickup_fee_cents ? 'text-blue-700' : ''}`}>
                            {formatCurrency(calculatedPricing.same_day_pickup_fee_cents)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Tax (6%):</span>
                      <div className="flex items-center gap-2">
                        {calculatedPricing.tax_cents !== order.tax_cents && (
                          <span className="text-xs text-slate-400 line-through">{formatCurrency(order.tax_cents)}</span>
                        )}
                        <span className={`font-medium ${calculatedPricing.tax_cents !== order.tax_cents ? 'text-blue-700' : ''}`}>
                          {formatCurrency(calculatedPricing.tax_cents)}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between text-base font-semibold border-t border-blue-300 pt-2">
                      <span>Total:</span>
                      <div className="flex items-center gap-2">
                        {calculatedPricing.total_cents !== (order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents) && (
                          <span className="text-sm text-slate-400 line-through">
                            {formatCurrency(order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)}
                          </span>
                        )}
                        <span className={calculatedPricing.total_cents !== (order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents) ? 'text-blue-700' : ''}>
                          {formatCurrency(calculatedPricing.total_cents)}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-green-700">
                      <span>Deposit Due:</span>
                      <div className="flex items-center gap-2">
                        {calculatedPricing.deposit_due_cents !== order.deposit_due_cents && (
                          <span className="text-xs text-slate-400 line-through">{formatCurrency(order.deposit_due_cents)}</span>
                        )}
                        <span className="font-semibold">{formatCurrency(calculatedPricing.deposit_due_cents)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Balance Due:</span>
                      <div className="flex items-center gap-2">
                        {calculatedPricing.balance_due_cents !== order.balance_due_cents && (
                          <span className="text-xs text-slate-400 line-through">{formatCurrency(order.balance_due_cents)}</span>
                        )}
                        <span className={`font-medium ${calculatedPricing.balance_due_cents !== order.balance_due_cents ? 'text-blue-700' : ''}`}>
                          {formatCurrency(calculatedPricing.balance_due_cents)}
                        </span>
                      </div>
                    </div>
                  </div>
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

                <div className="space-y-2">
                  <input
                    type="text"
                    value={newDiscount.name}
                    onChange={(e) => setNewDiscount({ ...newDiscount, name: e.target.value })}
                    placeholder="Discount name"
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={discountAmountInput}
                      onChange={(e) => setDiscountAmountInput(e.target.value)}
                      placeholder="Amount ($)"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                    />
                    <input
                      type="number"
                      step="1"
                      value={discountPercentInput}
                      onChange={(e) => setDiscountPercentInput(e.target.value)}
                      placeholder="Percentage (%)"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                    />
                  </div>
                  <button
                    onClick={handleAddDiscount}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm font-medium"
                  >
                    Add Discount
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Order Status</h3>
                <div className="flex flex-wrap gap-2">
                  {['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'].map(status => (
                    <button
                      key={status}
                      onClick={() => handleStatusChange(status)}
                      className={`px-3 py-1 rounded text-sm font-medium ${
                        order.status === status
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {status.replace('_', ' ').toUpperCase()}
                    </button>
                  ))}
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
    </div>
  );
}
