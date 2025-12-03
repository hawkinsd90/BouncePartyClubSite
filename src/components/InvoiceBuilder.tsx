import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Trash2, DollarSign, Percent, Save, UserPlus, Copy, Check, Send, Link as LinkIcon, Calendar, MapPin, Clock, Users } from 'lucide-react';
import { AddressAutocomplete } from './AddressAutocomplete';

export function InvoiceBuilder() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [discountType, setDiscountType] = useState<'dollar' | 'percent'>('dollar');
  const [discountValue, setDiscountValue] = useState('0');
  const [waiveDeposit, setWaiveDeposit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [customDepositAmount, setCustomDepositAmount] = useState('');
  const [useCustomDeposit, setUseCustomDeposit] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [eventDetails, setEventDetails] = useState({
    event_date: '',
    event_end_date: '',
    start_window: '09:00 AM',
    end_window: '05:00 PM',
    location_type: 'residential',
    address_line1: '',
    address_line2: '',
    city: '',
    state: 'MI',
    zip: '',
    surface: 'grass',
    generator_qty: 0,
    pickup_preference: 'next_day',
  });
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [customersRes, unitsRes] = await Promise.all([
      supabase.from('customers').select('*').order('last_name'),
      supabase.from('units').select('*').eq('active', true).order('name'),
    ]);

    if (customersRes.data) setCustomers(customersRes.data);
    if (unitsRes.data) setUnits(unitsRes.data);
  }

  function addItemToCart(unit: any, mode: 'dry' | 'water') {
    const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

    setCartItems([
      ...cartItems,
      {
        id: crypto.randomUUID(),
        unit_id: unit.id,
        unit_name: unit.name,
        mode,
        price_cents: price,
        adjusted_price_cents: price,
        qty: 1,
      },
    ]);
  }

  function removeItemFromCart(itemId: string) {
    setCartItems(cartItems.filter(item => item.id !== itemId));
  }

  function updateItemQuantity(itemId: string, qty: number) {
    setCartItems(
      cartItems.map(item =>
        item.id === itemId ? { ...item, qty: Math.max(1, qty) } : item
      )
    );
  }

  function updateItemPrice(itemId: string, priceCents: number) {
    setCartItems(
      cartItems.map(item =>
        item.id === itemId ? { ...item, adjusted_price_cents: priceCents } : item
      )
    );
  }

  const subtotal = cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0);

  let discountAmount = 0;
  if (discountType === 'dollar') {
    discountAmount = Math.round(parseFloat(discountValue || '0') * 100);
  } else {
    discountAmount = Math.round(subtotal * (parseFloat(discountValue || '0') / 100));
  }

  const totalAfterDiscount = Math.max(0, subtotal - discountAmount);
  const defaultDeposit = Math.round(totalAfterDiscount * 0.5);
  const depositRequired = useCustomDeposit
    ? Math.round(parseFloat(customDepositAmount || '0') * 100)
    : waiveDeposit
    ? 0
    : defaultDeposit;

  async function handleCreateNewCustomer() {
    if (!newCustomer.first_name || !newCustomer.last_name || !newCustomer.email || !newCustomer.phone) {
      alert('Please fill in all required customer fields');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert([newCustomer])
        .select()
        .single();

      if (error) throw error;

      setCustomers([...customers, data]);
      setSelectedCustomer(data.id);
      setShowNewCustomerForm(false);
      setNewCustomer({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        business_name: '',
      });
    } catch (error) {
      console.error('Error creating customer:', error);
      alert('Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateInvoice() {
    if (cartItems.length === 0) {
      alert('Please add at least one item to the cart');
      return;
    }

    if (!eventDetails.event_date || !eventDetails.address_line1) {
      alert('Please fill in event details (date and address)');
      return;
    }

    if (!cardOnFileConsent || !smsConsent) {
      alert('Please accept the authorization and consent terms');
      return;
    }

    setSaving(true);
    try {
      // 1. Create or get customer
      let customerId = selectedCustomer;
      const customer = customers.find(c => c.id === selectedCustomer);

      // 2. Create address
      const { data: address, error: addressError } = await supabase
        .from('addresses')
        .insert({
          line1: eventDetails.address_line1,
          line2: eventDetails.address_line2,
          city: eventDetails.city,
          state: eventDetails.state,
          zip: eventDetails.zip,
        })
        .select()
        .single();

      if (addressError) throw addressError;

      // 3. Calculate pricing
      const taxRate = 0.06;
      const taxCents = Math.round(totalAfterDiscount * taxRate);
      const totalWithTax = totalAfterDiscount + taxCents;

      // 4. Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customerId || null,
          address_id: address.id,
          event_date: eventDetails.event_date,
          event_end_date: eventDetails.event_end_date || eventDetails.event_date,
          start_window: eventDetails.start_window,
          end_window: eventDetails.end_window,
          location_type: eventDetails.location_type,
          surface: eventDetails.surface,
          generator_qty: eventDetails.generator_qty,
          pickup_preference: eventDetails.pickup_preference,
          subtotal_cents: subtotal,
          discount_cents: discountAmount,
          tax_cents: taxCents,
          total_cents: totalWithTax,
          deposit_due_cents: depositRequired,
          balance_due_cents: totalWithTax - depositRequired,
          custom_deposit_cents: useCustomDeposit ? depositRequired : null,
          status: 'draft',
          card_on_file_consent: cardOnFileConsent,
          sms_consent: smsConsent,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // 5. Create order items
      const orderItems = cartItems.map(item => ({
        order_id: order.id,
        unit_id: item.unit_id,
        qty: item.qty,
        wet_or_dry: item.mode,
        unit_price_cents: item.adjusted_price_cents,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      // 6. Send invoice
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invoice`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: order.id,
            depositCents: depositRequired,
            customerEmail: customer?.email || null,
            customerPhone: customer?.phone || null,
            customerName: customer ? `${customer.first_name} ${customer.last_name}` : null,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invoice');
      }

      setInvoiceUrl(data.invoiceUrl);

      // If no customer selected, show the link to copy
      if (!customerId) {
        alert('Invoice created! Copy the link below to send to your customer.');
      } else {
        alert(`Invoice sent to ${customer.email} and ${customer.phone}!`);
      }

      // Reset form
      setCartItems([]);
      setDiscountValue('0');
      setSelectedCustomer('');
      setEventDetails({
        event_date: '',
        event_end_date: '',
        start_window: '09:00 AM',
        end_window: '05:00 PM',
        location_type: 'residential',
        address_line1: '',
        address_line2: '',
        city: '',
        state: 'MI',
        zip: '',
        surface: 'grass',
        generator_qty: 0,
        pickup_preference: 'next_day',
      });
    } catch (error) {
      console.error('Error generating invoice:', error);
      alert('Failed to generate invoice: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(invoiceUrl);
    setCopiedToClipboard(true);
    setTimeout(() => setCopiedToClipboard(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Invoice Builder</h2>
        <p className="text-slate-600 mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
      </div>

      {invoiceUrl && (
        <div className="bg-green-50 border-2 border-green-500 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Check className="w-6 h-6 text-green-600 mr-2" />
              <h3 className="text-lg font-semibold text-green-900">Invoice Created Successfully!</h3>
            </div>
          </div>
          <p className="text-green-800 mb-4">
            {selectedCustomer
              ? 'Invoice has been sent to the customer via email and SMS.'
              : 'Copy the link below and send it to your customer to fill in their information and accept the invoice.'}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={invoiceUrl}
              readOnly
              className="flex-1 px-4 py-2 border border-green-300 rounded-lg bg-white text-slate-900"
            />
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              {copiedToClipboard ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Select Customer</h3>
              <button
                onClick={() => setShowNewCustomerForm(!showNewCustomerForm)}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                New Customer
              </button>
            </div>
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a customer or leave blank...</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.first_name} {customer.last_name} - {customer.email}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-2">
              Leave blank to generate a shareable link for customer to fill in their details
            </p>

            {showNewCustomerForm && (
              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <h4 className="font-medium text-slate-900 mb-3">Create New Customer</h4>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="First Name *"
                    value={newCustomer.first_name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, first_name: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Last Name *"
                    value={newCustomer.last_name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, last_name: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="email"
                    placeholder="Email *"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone *"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Business Name (optional)"
                    value={newCustomer.business_name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, business_name: e.target.value })}
                    className="col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={handleCreateNewCustomer}
                  disabled={saving}
                  className="mt-3 w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white py-2 rounded-lg text-sm transition-colors"
                >
                  {saving ? 'Creating...' : 'Create Customer'}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Event Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Event Start Date *</label>
                  <input
                    type="date"
                    required
                    value={eventDetails.event_date}
                    onChange={(e) => setEventDetails({ ...eventDetails, event_date: e.target.value, event_end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Event End Date</label>
                  <input
                    type="date"
                    value={eventDetails.event_end_date || eventDetails.event_date}
                    onChange={(e) => setEventDetails({ ...eventDetails, event_end_date: e.target.value })}
                    min={eventDetails.event_date}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Start Time</label>
                  <input
                    type="time"
                    value={eventDetails.start_window}
                    onChange={(e) => setEventDetails({ ...eventDetails, start_window: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">End Time</label>
                  <input
                    type="time"
                    value={eventDetails.end_window}
                    onChange={(e) => setEventDetails({ ...eventDetails, end_window: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Street Address *</label>
                <AddressAutocomplete
                  value={eventDetails.address_line1}
                  onChange={(value) => setEventDetails({ ...eventDetails, address_line1: value })}
                  onPlaceSelected={(place) => {
                    setEventDetails({
                      ...eventDetails,
                      address_line1: place.line1,
                      city: place.city,
                      state: place.state,
                      zip: place.zip,
                    });
                  }}
                  placeholder="Enter street address"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <input
                  type="text"
                  placeholder="City"
                  value={eventDetails.city}
                  onChange={(e) => setEventDetails({ ...eventDetails, city: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="State"
                  value={eventDetails.state}
                  onChange={(e) => setEventDetails({ ...eventDetails, state: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="ZIP"
                  value={eventDetails.zip}
                  onChange={(e) => setEventDetails({ ...eventDetails, zip: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Location Type</label>
                <select
                  value={eventDetails.location_type}
                  onChange={(e) => setEventDetails({ ...eventDetails, location_type: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="residential">Residential</option>
                  <option value="park">Park</option>
                  <option value="school">School</option>
                  <option value="church">Church</option>
                  <option value="business">Business</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Setup Surface</label>
                <select
                  value={eventDetails.surface}
                  onChange={(e) => setEventDetails({ ...eventDetails, surface: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="grass">Grass</option>
                  <option value="cement">Cement/Asphalt</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Available Units</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {units.map(unit => (
                <div key={unit.id} className="border border-slate-200 rounded-lg p-3">
                  <p className="font-medium text-slate-900 text-sm">{unit.name}</p>
                  <p className="text-xs text-slate-600 mb-2">{unit.dimensions}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addItemToCart(unit, 'dry')}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                    >
                      Dry {formatCurrency(unit.price_dry_cents)}
                    </button>
                    {unit.price_water_cents && (
                      <button
                        onClick={() => addItemToCart(unit, 'water')}
                        className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-1 px-2 rounded"
                      >
                        Water {formatCurrency(unit.price_water_cents)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Cart Items</h3>
            {cartItems.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items in cart</p>
            ) : (
              <div className="space-y-3">
                {cartItems.map(item => (
                  <div key={item.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-slate-900">{item.unit_name}</p>
                        <p className="text-xs text-slate-600 capitalize">{item.mode} Mode</p>
                      </div>
                      <button
                        onClick={() => removeItemFromCart(item.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value))}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Price Each</label>
                        <input
                          type="number"
                          step="0.01"
                          value={(item.adjusted_price_cents / 100).toFixed(2)}
                          onChange={(e) => updateItemPrice(item.id, Math.round(parseFloat(e.target.value) * 100))}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-right">
                      <span className="text-sm text-slate-600">Line Total: </span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(item.adjusted_price_cents * item.qty)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Discounts & Adjustments</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Discount Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiscountType('dollar')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border-2 transition-colors ${
                      discountType === 'dollar'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    Dollar
                  </button>
                  <button
                    onClick={() => setDiscountType('percent')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border-2 transition-colors ${
                      discountType === 'percent'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <Percent className="w-4 h-4" />
                    Percent
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Discount Amount {discountType === 'percent' && '(%)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="waive-deposit"
                    checked={waiveDeposit}
                    onChange={(e) => {
                      setWaiveDeposit(e.target.checked);
                      if (e.target.checked) setUseCustomDeposit(false);
                    }}
                    className="mr-2"
                  />
                  <label htmlFor="waive-deposit" className="text-sm text-slate-700">
                    Waive Deposit (Full payment required)
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="custom-deposit"
                    checked={useCustomDeposit}
                    onChange={(e) => {
                      setUseCustomDeposit(e.target.checked);
                      if (e.target.checked) setWaiveDeposit(false);
                    }}
                    className="mr-2"
                  />
                  <label htmlFor="custom-deposit" className="text-sm text-slate-700">
                    Set Custom Deposit Amount
                  </label>
                </div>

                {useCustomDeposit && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Custom Deposit Amount (can be $0)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-slate-600">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={(totalAfterDiscount / 100).toFixed(2)}
                        value={customDepositAmount}
                        onChange={(e) => setCustomDepositAmount(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    {parseFloat(customDepositAmount || '0') === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        With $0 deposit, customer only needs to accept (no payment required)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Authorization & Consent</h3>
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="text-sm text-slate-700 mb-3">
                  I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt. I understand that any charges will be accompanied by photographic evidence and a detailed explanation.
                </p>
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cardOnFileConsent}
                    onChange={(e) => setCardOnFileConsent(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5 mr-2"
                  />
                  <span className="text-sm text-slate-700">
                    I agree to the card-on-file authorization terms *
                  </span>
                </label>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="text-sm text-slate-700 mb-3">
                  By checking this box, I consent to receive transactional SMS text messages from Bounce Party Club LLC. These messages may include order confirmations, delivery updates, and service-related notifications. Message and data rates may apply. Reply STOP to opt-out.
                </p>
                <label className="flex items-start cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5 mr-2"
                  />
                  <span className="text-sm text-slate-700">
                    I consent to receive SMS notifications *
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Invoice Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-red-700">
                  <span>Discount:</span>
                  <span className="font-semibold">-{formatCurrency(discountAmount)}</span>
                </div>
              )}

              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="font-semibold text-slate-900">Total:</span>
                <span className="text-xl font-bold text-blue-600">{formatCurrency(totalAfterDiscount)}</span>
              </div>

              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="text-slate-600">Deposit {waiveDeposit && '(Waived)'}:</span>
                <span className="font-semibold text-green-700">{formatCurrency(depositRequired)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-600">Balance Due:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(totalAfterDiscount - depositRequired)}</span>
              </div>
            </div>

            <button
              onClick={handleGenerateInvoice}
              disabled={saving || cartItems.length === 0 || !cardOnFileConsent || !smsConsent}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Send className="w-5 h-5" />
              {saving ? 'Generating...' : selectedCustomer ? 'Send Invoice to Customer' : 'Generate Shareable Link'}
            </button>
            <p className="text-xs text-slate-500 text-center mt-2">
              {selectedCustomer
                ? 'Invoice will be sent via email and SMS'
                : 'A shareable link will be generated for you to send manually'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
