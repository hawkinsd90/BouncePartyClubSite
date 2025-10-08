import { useState, useEffect } from 'react';
import { X, Truck, MapPin, CheckCircle, MessageSquare, DollarSign, FileText, Calendar, Edit2, History, Save, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { formatCurrency } from '../lib/pricing';

interface OrderDetailModalProps {
  order: any;
  onClose: () => void;
  onUpdate: () => void;
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
    generator_qty: order.generator_qty || 0,
    start_window: order.start_window,
    end_window: order.end_window,
    event_date: order.event_date,
    discount_amount_cents: order.discount_amount_cents || 0,
    discount_percentage: order.discount_percentage || 0,
    address_line1: order.addresses?.line1 || '',
    address_line2: order.addresses?.line2 || '',
    address_city: order.addresses?.city || '',
    address_state: order.addresses?.state || '',
    address_zip: order.addresses?.zip || '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOrderDetails();
  }, [order.id]);

  async function loadOrderDetails() {
    try {
      const [itemsRes, notesRes, eventsRes, changelogRes, unitsRes] = await Promise.all([
        supabase.from('order_items').select('*, units(name, price_dry_cents, price_water_cents)').eq('order_id', order.id),
        supabase.from('order_notes').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_workflow_events').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('order_changelog').select('*, user:user_id(email)').eq('order_id', order.id).order('created_at', { ascending: false }),
        supabase.from('units').select('*').eq('active', true).order('name'),
      ]);

      if (itemsRes.data) setOrderItems(itemsRes.data);
      if (notesRes.data) setNotes(notesRes.data);
      if (eventsRes.data) setWorkflowEvents(eventsRes.data);
      if (changelogRes.data) setChangelog(changelogRes.data);
      if (unitsRes.data) setAvailableUnits(unitsRes.data);
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
      alert('Note added successfully!');
    } catch (error) {
      console.error('Error adding note:', error);
      alert('Failed to add note');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleWorkflowAction(action: 'on_the_way' | 'arrived' | 'setup_completed' | 'pickup_completed') {
    try {
      const user = (await supabase.auth.getUser()).data.user;

      await supabase.from('order_workflow_events').insert({
        order_id: order.id,
        event_type: action,
        user_id: user?.id,
        eta: action === 'on_the_way' && eta ? new Date(eta).toISOString() : null,
      });

      let newWorkflowStatus = 'pending';
      let orderStatus = order.status;

      if (action === 'on_the_way') newWorkflowStatus = 'on_the_way';
      if (action === 'arrived') newWorkflowStatus = 'arrived';
      if (action === 'setup_completed') newWorkflowStatus = 'setup_completed';
      if (action === 'pickup_completed') {
        newWorkflowStatus = 'completed';
        orderStatus = 'completed';
      }

      await supabase.from('orders').update({
        workflow_status: newWorkflowStatus,
        status: orderStatus,
        current_eta: action === 'on_the_way' && eta ? new Date(eta).toISOString() : order.current_eta,
      }).eq('id', order.id);

      if (action === 'on_the_way') {
        const portalLink = `${window.location.origin}/customer-portal/${order.id}`;
        const message = `Hi ${order.customers?.first_name}, we're on our way! ETA: ${eta}. Complete any remaining steps here: ${portalLink}`;
        await sendSMS(message);
      }

      if (action === 'arrived') {
        const alerts = [];
        if (order.has_pets) alerts.push('Please secure any pets');
        if (order.balance_due_cents > order.balance_paid_cents) alerts.push('Remaining balance due');
        if (!order.waiver_signed_at) alerts.push('Waiver not yet signed');
        const alertText = alerts.length > 0 ? ` Reminders: ${alerts.join(', ')}` : '';
        const message = `Hi ${order.customers?.first_name}, we've arrived!${alertText}`;
        await sendSMS(message);
      }

      if (action === 'setup_completed') {
        const message = order.overnight_allowed
          ? `Setup complete! Pickup scheduled for tomorrow at ${order.start_window}. Please follow all safety rules.`
          : `Setup complete! Enjoy your event. Pickup at ${order.end_window}. Thank you!`;
        await sendSMS(message);
      }

      if (action === 'pickup_completed') {
        const message = `Thank you for choosing Bounce Party Club! We hope you had a great event. We'd love to hear your feedback!`;
        await sendSMS(message);

        await logChange('order_status', order.status, 'completed', 'status_change');
      }

      await loadOrderDetails();
      onUpdate();
      alert('Workflow action completed!');
    } catch (error) {
      console.error('Error processing workflow action:', error);
      alert('Failed to process workflow action');
    }
  }

  async function logChange(field: string, oldVal: any, newVal: any, changeType: string = 'edit') {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      await supabase.from('order_changelog').insert({
        order_id: order.id,
        user_id: user?.id,
        field_changed: field,
        old_value: String(oldVal),
        new_value: String(newVal),
        change_type: changeType,
      });
    } catch (error) {
      console.error('Error logging change:', error);
    }
  }

  async function handleSaveChanges() {
    setSaving(true);
    try {
      const changes: any = {};
      const logs = [];

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
        logs.push(['event_date', order.event_date, editedOrder.event_date]);
      }
      if (editedOrder.discount_amount_cents !== (order.discount_amount_cents || 0)) {
        changes.discount_amount_cents = editedOrder.discount_amount_cents;
        logs.push(['discount_amount_cents', order.discount_amount_cents || 0, editedOrder.discount_amount_cents]);
      }
      if (editedOrder.discount_percentage !== (order.discount_percentage || 0)) {
        changes.discount_percentage = editedOrder.discount_percentage;
        logs.push(['discount_percentage', order.discount_percentage || 0, editedOrder.discount_percentage]);
      }

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

        const { data: settings } = await supabase.from('admin_settings').select('*').single();
        if (settings) {
          const homeBase = { lat: settings.home_base_lat, lng: settings.home_base_lng };
          const destination = `${editedOrder.address_line1}, ${editedOrder.address_city}, ${editedOrder.address_state} ${editedOrder.address_zip}`;

          const distance = await calculateDistance(homeBase, destination);
          const travelFee = calculateTravelFee(distance, settings);

          changes.travel_fee_cents = travelFee;
          changes.distance_miles = distance;
          logs.push(['travel_fee', order.travel_fee_cents, travelFee]);
        }
      }

      if (Object.keys(changes).length > 0) {
        await supabase.from('orders').update(changes).eq('id', order.id);

        for (const [field, oldVal, newVal] of logs) {
          await logChange(field, oldVal, newVal);
        }
      }

      await loadOrderDetails();
      onUpdate();
      alert('Changes saved successfully!');
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function calculateDistance(origin: { lat: number; lng: number }, destination: string): Promise<number> {
    return new Promise((resolve) => {
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

  function calculateTravelFee(distance: number, settings: any): number {
    const freeRadius = settings.travel_free_radius_miles || 0;
    const perMile = settings.travel_fee_per_mile_cents || 0;
    const minFee = settings.travel_min_fee_cents || 0;
    const maxFee = settings.travel_max_fee_cents || 999999;

    if (distance <= freeRadius) return 0;

    const chargeableMiles = distance - freeRadius;
    let fee = Math.round(chargeableMiles * perMile);

    if (fee < minFee) fee = minFee;
    if (fee > maxFee) fee = maxFee;

    return fee;
  }

  function startEditing() {
    setEditedOrder({
      event_date: order.event_date,
      start_window: order.start_window,
      end_window: order.end_window,
    });
    setIsEditing(true);
  }

  async function saveEdits() {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const changes: any = {};

      if (editedOrder.event_date !== order.event_date) {
        changes.event_date = editedOrder.event_date;
        await logChange('event_date', order.event_date, editedOrder.event_date);
      }
      if (editedOrder.start_window !== order.start_window) {
        changes.start_window = editedOrder.start_window;
        await logChange('start_window', order.start_window, editedOrder.start_window);
      }
      if (editedOrder.end_window !== order.end_window) {
        changes.end_window = editedOrder.end_window;
        await logChange('end_window', order.end_window, editedOrder.end_window);
      }

      if (Object.keys(changes).length > 0) {
        await supabase.from('orders').update(changes).eq('id', order.id);
      }

      setIsEditing(false);
      await loadOrderDetails();
      onUpdate();
      alert('Changes saved successfully!');
    } catch (error) {
      console.error('Error saving edits:', error);
      alert('Failed to save changes');
    }
  }

  async function removeItem(itemId: string, itemName: string) {
    if (!confirm(`Remove ${itemName} from this order?`)) return;

    try {
      await supabase.from('order_items').delete().eq('id', itemId);
      await logChange('order_items', itemName, 'removed', 'remove');
      await loadOrderDetails();
      onUpdate();
      alert('Item removed successfully!');
    } catch (error) {
      console.error('Error removing item:', error);
      alert('Failed to remove item');
    }
  }

  async function addItem(unit: any, mode: 'dry' | 'water') {
    try {
      const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

      await supabase.from('order_items').insert({
        order_id: order.id,
        unit_id: unit.id,
        qty: 1,
        wet_or_dry: mode,
        unit_price_cents: price,
      });

      await logChange('order_items', '', `${unit.name} (${mode})`, 'add');
      await loadOrderDetails();
      onUpdate();
      alert('Item added successfully!');
    } catch (error) {
      console.error('Error adding item:', error);
      alert('Failed to add item');
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

  const totalOrder = order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg max-w-6xl w-full my-8">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="text-sm text-slate-600">
              {order.customers?.first_name} {order.customers?.last_name} • {format(new Date(order.event_date), 'MMM d, yyyy')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isEditing
                  ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Edit2 className="w-4 h-4" />
              {isEditing ? 'View Mode' : 'Edit Mode'}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-b border-slate-200 overflow-x-auto">
          {[
            { key: 'details', label: 'Details', icon: FileText },
            { key: 'workflow', label: 'Workflow', icon: Truck },
            { key: 'notes', label: 'Notes', icon: MessageSquare },
            { key: 'changelog', label: 'Changelog', icon: History },
          ].map(section => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                activeSection === section.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <section.icon className="w-4 h-4" />
              {section.label}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[calc(90vh-200px)] overflow-y-auto">
          {activeSection === 'details' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Customer Information</h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="font-medium">Name:</span> {order.customers?.first_name} {order.customers?.last_name}</p>
                    <p><span className="font-medium">Email:</span> {order.customers?.email}</p>
                    <p><span className="font-medium">Phone:</span> {order.customers?.phone}</p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Event Details</h3>
                  {isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Event Date</label>
                        <input
                          type="date"
                          value={editedOrder.event_date}
                          onChange={(e) => setEditedOrder({ ...editedOrder, event_date: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Start Time</label>
                          <input
                            type="time"
                            value={editedOrder.start_window}
                            onChange={(e) => setEditedOrder({ ...editedOrder, start_window: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">End Time</label>
                          <input
                            type="time"
                            value={editedOrder.end_window}
                            onChange={(e) => setEditedOrder({ ...editedOrder, end_window: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Location Type</label>
                        <select
                          value={editedOrder.location_type}
                          onChange={(e) => setEditedOrder({ ...editedOrder, location_type: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        >
                          <option value="commercial">Commercial</option>
                          <option value="home">Home</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Surface</label>
                        <select
                          value={editedOrder.surface}
                          onChange={(e) => setEditedOrder({ ...editedOrder, surface: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        >
                          <option value="grass">Grass</option>
                          <option value="concrete">Concrete</option>
                          <option value="asphalt">Asphalt</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Generator Quantity</label>
                        <input
                          type="number"
                          min="0"
                          value={editedOrder.generator_qty}
                          onChange={(e) => setEditedOrder({ ...editedOrder, generator_qty: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <p><span className="font-medium">Date:</span> {format(new Date(order.event_date), 'MMMM d, yyyy')}</p>
                      <p><span className="font-medium">Time:</span> {order.start_window} - {order.end_window}</p>
                      <p><span className="font-medium">Type:</span> {order.location_type} • {order.surface}</p>
                      <p><span className="font-medium">Generators:</span> {order.generator_qty || 0}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h3 className="font-semibold text-slate-900 mb-3">Address</h3>
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label>
                      <input
                        type="text"
                        value={editedOrder.address_line1}
                        onChange={(e) => setEditedOrder({ ...editedOrder, address_line1: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Address Line 2 (optional)</label>
                      <input
                        type="text"
                        value={editedOrder.address_line2}
                        onChange={(e) => setEditedOrder({ ...editedOrder, address_line2: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-1">
                        <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
                        <input
                          type="text"
                          value={editedOrder.address_city}
                          onChange={(e) => setEditedOrder({ ...editedOrder, address_city: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
                        <input
                          type="text"
                          value={editedOrder.address_state}
                          onChange={(e) => setEditedOrder({ ...editedOrder, address_state: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                          maxLength={2}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">ZIP</label>
                        <input
                          type="text"
                          value={editedOrder.address_zip}
                          onChange={(e) => setEditedOrder({ ...editedOrder, address_zip: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-amber-600">Address changes will recalculate travel fees</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm">{order.addresses?.line1}</p>
                    {order.addresses?.line2 && <p className="text-sm">{order.addresses.line2}</p>}
                    <p className="text-sm">{order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}</p>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900">Order Items</h3>
                  {isEditing && (
                    <span className="text-xs text-slate-600 bg-yellow-100 px-2 py-1 rounded">Edit Mode Active</span>
                  )}
                </div>
                <div className="space-y-2">
                  {orderItems.map(item => (
                    <div key={item.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.units?.name}</p>
                        <p className="text-sm text-slate-600">{item.wet_or_dry === 'water' ? 'Water' : 'Dry'} • Qty: {item.qty}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold">{formatCurrency(item.unit_price_cents * item.qty)}</p>
                        {isEditing && (
                          <button
                            onClick={() => removeItem(item.id, item.units?.name)}
                            className="text-red-600 hover:text-red-800 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {isEditing && (
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
                              onClick={() => addItem(unit, 'dry')}
                              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded"
                            >
                              Add Dry ({formatCurrency(unit.price_dry_cents)})
                            </button>
                            {unit.price_water_cents && (
                              <button
                                onClick={() => addItem(unit, 'water')}
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
                )}
              </div>

              {isEditing && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Discount</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Discount Amount ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={(editedOrder.discount_amount_cents / 100).toFixed(2)}
                        onChange={(e) => setEditedOrder({ ...editedOrder, discount_amount_cents: Math.round(parseFloat(e.target.value) * 100) || 0, discount_percentage: 0 })}
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Discount Percentage (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editedOrder.discount_percentage}
                        onChange={(e) => setEditedOrder({ ...editedOrder, discount_percentage: parseFloat(e.target.value) || 0, discount_amount_cents: 0 })}
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mt-2">Enter either a dollar amount or percentage (not both)</p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-semibold">{formatCurrency(order.subtotal_cents)}</span>
                  </div>
                  {order.travel_fee_cents > 0 && (
                    <div className="flex justify-between">
                      <span>Travel Fee:</span>
                      <span className="font-semibold">{formatCurrency(order.travel_fee_cents)}</span>
                    </div>
                  )}
                  {(order.discount_amount_cents > 0 || order.discount_percentage > 0) && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount:</span>
                      <span className="font-semibold">
                        -{formatCurrency(order.discount_amount_cents || Math.round(order.subtotal_cents * (order.discount_percentage / 100)))}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-blue-300 text-lg">
                    <span className="font-bold">Total:</span>
                    <span className="font-bold">{formatCurrency(totalOrder)}</span>
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveChanges}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
                  >
                    <Save className="w-5 h-5" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeSection === 'workflow' && (
            <div className="space-y-6">
              {order.status === 'confirmed' && (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-slate-900 mb-4">Workflow Actions</h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Set ETA (for On the Way notification)
                        </label>
                        <input
                          type="datetime-local"
                          value={eta}
                          onChange={(e) => setEta(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button
                          onClick={() => handleWorkflowAction('on_the_way')}
                          disabled={!eta}
                          className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-400 text-white py-3 px-4 rounded-lg font-medium"
                        >
                          <Truck className="w-5 h-5" />
                          On the Way
                        </button>
                        <button
                          onClick={() => handleWorkflowAction('arrived')}
                          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium"
                        >
                          <MapPin className="w-5 h-5" />
                          Arrived
                        </button>
                        <button
                          onClick={() => handleWorkflowAction('setup_completed')}
                          className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-medium"
                        >
                          <CheckCircle className="w-5 h-5" />
                          Setup Complete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Workflow History</h3>
                {workflowEvents.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No workflow events yet</p>
                ) : (
                  <div className="space-y-3">
                    {workflowEvents.map(event => (
                      <div key={event.id} className="bg-slate-50 rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-slate-900 capitalize">
                              {event.event_type.replace(/_/g, ' ')}
                            </p>
                            <p className="text-sm text-slate-600">By: {event.user?.email}</p>
                            {event.eta && (
                              <p className="text-sm text-slate-600">ETA: {format(new Date(event.eta), 'MMM d, h:mm a')}</p>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{format(new Date(event.created_at), 'MMM d, h:mm a')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'notes' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Add Note</label>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Enter notes about this order..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg resize-none"
                  rows={3}
                />
                <button
                  onClick={handleAddNote}
                  disabled={savingNote || !newNote.trim()}
                  className="mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white py-2 px-6 rounded-lg font-medium"
                >
                  {savingNote ? 'Saving...' : 'Add Note'}
                </button>
              </div>

              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Notes History</h3>
                {notes.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No notes yet</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map(note => (
                      <div key={note.id} className="bg-slate-50 rounded-lg p-4">
                        <p className="text-slate-900 whitespace-pre-wrap">{note.note}</p>
                        <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                          <span>By: {note.user?.email}</span>
                          <span>{format(new Date(note.created_at), 'MMM d, h:mm a')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
