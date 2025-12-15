import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { calculatePrice, calculateDrivingDistance, type PricingRules, type PriceBreakdown } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { Send } from 'lucide-react';
import { OrderSummary } from './OrderSummary';
import { type OrderSummaryDisplay } from '../lib/orderSummary';
import { showToast } from '../lib/notifications';
import { DiscountsManager } from './order-detail/DiscountsManager';
import { CustomFeesManager } from './order-detail/CustomFeesManager';
import { EventDetailsEditor } from './order-detail/EventDetailsEditor';
import { DepositOverride } from './order-detail/DepositOverride';
import { CustomerSelector } from './invoice/CustomerSelector';
import { NewCustomerForm } from './invoice/NewCustomerForm';
import { CartItemsList } from './invoice/CartItemsList';
import { InvoiceSuccessMessage } from './invoice/InvoiceSuccessMessage';
import { AdminMessageSection } from './invoice/AdminMessageSection';

export function InvoiceBuilder() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [pricingRules, setPricingRules] = useState<PricingRules | null>(null);
  const [priceBreakdown, setPriceBreakdown] = useState<PriceBreakdown | null>(null);
  const [eventDetails, setEventDetails] = useState({
    event_date: '',
    event_end_date: '',
    start_window: '09:00',
    end_window: '17:00',
    until_end_of_day: false,
    location_type: 'residential',
    address_line1: '',
    address_line2: '',
    city: '',
    state: 'MI',
    zip: '',
    lat: 0,
    lng: 0,
    surface: 'grass',
    generator_qty: 0,
    pickup_preference: 'next_day',
    same_day_responsibility_accepted: false,
    overnight_responsibility_accepted: false,
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (eventDetails.location_type === 'commercial') {
      setEventDetails(prev => ({
        ...prev,
        pickup_preference: 'same_day',
        until_end_of_day: false,
        same_day_responsibility_accepted: false,
        overnight_responsibility_accepted: false,
      }));
    }
  }, [eventDetails.location_type]);

  useEffect(() => {
    const isSameDayRestricted = (eventDetails.location_type === 'residential' && eventDetails.pickup_preference === 'same_day') || eventDetails.location_type === 'commercial';

    if (isSameDayRestricted) {
      setEventDetails(prev => ({
        ...prev,
        event_end_date: prev.event_date,
        until_end_of_day: false,
        end_window: prev.end_window > '19:00' ? '19:00' : prev.end_window,
      }));
    }
  }, [eventDetails.pickup_preference, eventDetails.location_type, eventDetails.event_date]);

  useEffect(() => {
    if (cartItems.length > 0 && pricingRules && eventDetails.zip && eventDetails.lat && eventDetails.lng && eventDetails.event_date && eventDetails.event_end_date) {
      calculatePricing();
    }
  }, [cartItems, pricingRules, eventDetails, discounts, customFees]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showCustomerDropdown && !target.closest('.customer-search-container')) {
        setShowCustomerDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustomerDropdown]);

  async function loadData() {
    const [customersRes, unitsRes, rulesRes] = await Promise.all([
      supabase.from('customers').select('*').order('last_name'),
      supabase.from('units').select('*').eq('active', true).order('name'),
      supabase.from('pricing_rules').select('*').single(),
    ]);

    if (customersRes.data) setCustomers(customersRes.data);
    if (unitsRes.data) setUnits(unitsRes.data);
    if (rulesRes.data) {
      setPricingRules({
        base_radius_miles: rulesRes.data.base_radius_miles,
        included_city_list_json: rulesRes.data.included_city_list_json as string[],
        per_mile_after_base_cents: rulesRes.data.per_mile_after_base_cents,
        zone_overrides_json: rulesRes.data.zone_overrides_json as Array<{ zip: string; flat_cents: number }>,
        surface_sandbag_fee_cents: rulesRes.data.surface_sandbag_fee_cents,
        residential_multiplier: rulesRes.data.residential_multiplier,
        commercial_multiplier: rulesRes.data.commercial_multiplier,
        same_day_matrix_json: rulesRes.data.same_day_matrix_json as Array<{
          units: number;
          generator: boolean;
          subtotal_ge_cents: number;
          fee_cents: number;
        }>,
        overnight_holiday_only: rulesRes.data.overnight_holiday_only,
        extra_day_pct: rulesRes.data.extra_day_pct,
        generator_price_cents: rulesRes.data.generator_price_cents,
      });
    }
  }

  async function calculatePricing() {
    if (!pricingRules) return;

    try {
      const distance = await calculateDrivingDistance(
        HOME_BASE.lat,
        HOME_BASE.lng,
        eventDetails.lat,
        eventDetails.lng
      );

      const eventStartDate = new Date(eventDetails.event_date);
      const eventEndDate = new Date(eventDetails.event_end_date);
      const diffTime = Math.abs(eventEndDate.getTime() - eventStartDate.getTime());
      const numDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      const items = cartItems.map(item => ({
        unit_id: item.unit_id,
        wet_or_dry: item.mode,
        unit_price_cents: item.adjusted_price_cents,
        qty: item.qty,
      }));

      const breakdown = calculatePrice({
        items,
        location_type: eventDetails.location_type as 'residential' | 'commercial',
        surface: eventDetails.surface as 'grass' | 'cement',
        can_use_stakes: eventDetails.surface === 'grass',
        overnight_allowed: eventDetails.pickup_preference === 'next_day',
        num_days: numDays,
        distance_miles: distance,
        city: eventDetails.city,
        zip: eventDetails.zip,
        has_generator: eventDetails.generator_qty > 0,
        generator_qty: eventDetails.generator_qty,
        rules: pricingRules,
      });

      setPriceBreakdown(breakdown);
    } catch (error) {
      console.error('Error calculating pricing:', error);
    }
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
        wet_or_dry: mode,
        price_cents: price,
        adjusted_price_cents: price,
        qty: 1,
      },
    ]);
  }

  function removeItemFromCart(index: number) {
    setCartItems(cartItems.filter((_, i) => i !== index));
  }

  function updateItemQuantity(index: number, qty: number) {
    setCartItems(
      cartItems.map((item, i) =>
        i === index ? { ...item, qty: Math.max(1, qty) } : item
      )
    );
  }

  function updateItemPrice(index: number, priceCents: number) {
    setCartItems(
      cartItems.map((item, i) =>
        i === index ? { ...item, adjusted_price_cents: priceCents } : item
      )
    );
  }

  const subtotal = cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0);

  const discountTotal = useMemo(() =>
    discounts.reduce((sum, d) => {
      if (d.amount_cents > 0) {
        return sum + d.amount_cents;
      } else if (d.percentage > 0) {
        return sum + Math.round(subtotal * (d.percentage / 100));
      }
      return sum;
    }, 0),
    [discounts, subtotal]
  );

  const customFeesTotal = useMemo(() =>
    customFees.reduce((sum, f) => sum + f.amount_cents, 0),
    [customFees]
  );

  const automaticFees = useMemo(() => {
    const travelFee = priceBreakdown?.travel_fee_cents || 0;
    const surfaceFee = priceBreakdown?.surface_fee_cents || 0;
    const sameDayPickupFee = priceBreakdown?.same_day_pickup_fee_cents || 0;
    const generatorFee = priceBreakdown?.generator_fee_cents || 0;
    return travelFee + surfaceFee + sameDayPickupFee + generatorFee;
  }, [priceBreakdown]);

  const actualSubtotal = useMemo(() =>
    priceBreakdown?.subtotal_cents || subtotal,
    [priceBreakdown, subtotal]
  );

  const taxableAmount = useMemo(() =>
    Math.max(0, actualSubtotal + automaticFees - discountTotal + customFeesTotal),
    [actualSubtotal, automaticFees, discountTotal, customFeesTotal]
  );

  const taxCents = useMemo(() =>
    Math.round(taxableAmount * 0.06),
    [taxableAmount]
  );

  const totalCents = useMemo(() =>
    actualSubtotal + automaticFees - discountTotal + customFeesTotal + taxCents,
    [actualSubtotal, automaticFees, discountTotal, customFeesTotal, taxCents]
  );

  const defaultDeposit = useMemo(() =>
    cartItems.reduce((sum, item) => sum + (item.qty * 5000), 0),
    [cartItems]
  );

  const depositRequired = useMemo(() =>
    customDepositCents !== null ? customDepositCents : defaultDeposit,
    [customDepositCents, defaultDeposit]
  );

  async function handleCreateNewCustomer() {
    if (!newCustomer.first_name || !newCustomer.last_name || !newCustomer.email || !newCustomer.phone) {
      showToast('Please fill in all required customer fields', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data: existingCustomers, error: checkError } = await supabase
        .from('customers')
        .select('first_name, last_name, email, phone')
        .or(`and(email.eq.${newCustomer.email},phone.eq.${newCustomer.phone})`);

      if (checkError) throw checkError;

      if (existingCustomers && existingCustomers.length > 0) {
        const existing = existingCustomers[0];
        if (existing.first_name.toLowerCase() === newCustomer.first_name.toLowerCase() &&
            existing.last_name.toLowerCase() === newCustomer.last_name.toLowerCase()) {
          showToast(`A customer with this email (${newCustomer.email}) and phone (${newCustomer.phone}) already exists with the same name.`, 'error');
          setSaving(false);
          return;
        }
        showToast(`A customer with both this email (${newCustomer.email}) AND phone number (${newCustomer.phone}) already exists. They can share one or the other, but not both unless the name is identical.`, 'error');
        setSaving(false);
        return;
      }

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
      showToast('Failed to create customer', 'error');
    } finally {
      setSaving(false);
    }
  }

  function applyDepositOverride() {
    const cents = Math.round(parseFloat(customDepositInput || '0') * 100);
    setCustomDepositCents(cents);
  }

  function clearDepositOverride() {
    setCustomDepositCents(null);
    setCustomDepositInput('');
  }

  async function handleGenerateInvoice() {
    if (cartItems.length === 0) {
      showToast('Please add at least one item to the cart', 'error');
      return;
    }

    if (!eventDetails.event_date || !eventDetails.address_line1) {
      showToast('Please fill in event details (date and address)', 'error');
      return;
    }

    setSaving(true);
    try {
      let customerId = selectedCustomer;
      const customer = customers.find(c => c.id === selectedCustomer);

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

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customerId,
          address_id: address.id,
          event_date: eventDetails.event_date,
          event_end_date: eventDetails.event_end_date || eventDetails.event_date,
          start_date: eventDetails.event_date,
          end_date: eventDetails.event_end_date || eventDetails.event_date,
          start_window: eventDetails.start_window,
          end_window: eventDetails.end_window,
          until_end_of_day: eventDetails.until_end_of_day,
          location_type: eventDetails.location_type,
          surface: eventDetails.surface,
          generator_qty: eventDetails.generator_qty,
          pickup_preference: eventDetails.pickup_preference,
          same_day_responsibility_accepted: eventDetails.same_day_responsibility_accepted,
          overnight_responsibility_accepted: eventDetails.overnight_responsibility_accepted,
          subtotal_cents: priceBreakdown?.subtotal_cents || subtotal,
          travel_fee_cents: priceBreakdown?.travel_fee_cents || 0,
          travel_total_miles: priceBreakdown?.travel_total_miles || 0,
          travel_base_radius_miles: priceBreakdown?.travel_base_radius_miles || 0,
          travel_chargeable_miles: priceBreakdown?.travel_chargeable_miles || 0,
          travel_per_mile_cents: priceBreakdown?.travel_per_mile_cents || 0,
          travel_is_flat_fee: priceBreakdown?.travel_is_flat_fee || false,
          surface_fee_cents: priceBreakdown?.surface_fee_cents || 0,
          same_day_pickup_fee_cents: priceBreakdown?.same_day_pickup_fee_cents || 0,
          generator_fee_cents: priceBreakdown?.generator_fee_cents || 0,
          tax_cents: taxCents,
          deposit_due_cents: depositRequired,
          balance_due_cents: totalCents - depositRequired,
          custom_deposit_cents: customDepositCents,
          status: 'draft',
          card_on_file_consent: false,
          sms_consent: false,
          admin_message: adminMessage || null,
        })
        .select()
        .single();

      if (orderError) throw orderError;

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

      if (discounts.length > 0) {
        const orderDiscounts = discounts.map(d => ({
          order_id: order.id,
          name: d.name,
          amount_cents: d.amount_cents,
          percentage: d.percentage,
        }));

        const { error: discountsError } = await supabase
          .from('order_discounts')
          .insert(orderDiscounts);

        if (discountsError) throw discountsError;
      }

      if (customFees.length > 0) {
        const orderFees = customFees.map(f => ({
          order_id: order.id,
          name: f.name,
          amount_cents: f.amount_cents,
        }));

        const { error: feesError } = await supabase
          .from('order_custom_fees')
          .insert(orderFees);

        if (feesError) throw feesError;
      }

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

      if (!customerId) {
        showToast('Invoice created! Copy the link below to send to your customer.', 'success');
      } else {
        showToast(`Invoice sent to ${customer.email} and ${customer.phone}!`, 'success');
      }

      setCartItems([]);
      setDiscounts([]);
      setCustomFees([]);
      setCustomDepositCents(null);
      setCustomDepositInput('');
      setAdminMessage('');
      setSelectedCustomer('');
      setEventDetails({
        event_date: '',
        event_end_date: '',
        start_window: '09:00',
        end_window: '17:00',
        until_end_of_day: false,
        location_type: 'residential',
        address_line1: '',
        address_line2: '',
        city: '',
        state: 'MI',
        zip: '',
        lat: 0,
        lng: 0,
        surface: 'grass',
        generator_qty: 0,
        pickup_preference: 'next_day',
        same_day_responsibility_accepted: false,
        overnight_responsibility_accepted: false,
      });
    } catch (error) {
      console.error('Error generating invoice:', error);
      showToast('Failed to generate invoice: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  function buildOrderSummary(): OrderSummaryDisplay | null {
    if (cartItems.length === 0) return null;

    const items = cartItems.map(item => ({
      name: item.unit_name,
      mode: item.mode === 'water' ? 'Water' : 'Dry',
      price: item.adjusted_price_cents,
      qty: item.qty,
      lineTotal: item.adjusted_price_cents * item.qty,
    }));

    const fees: Array<{ name: string; amount: number }> = [];

    if (priceBreakdown?.travel_fee_cents && priceBreakdown.travel_fee_cents > 0) {
      fees.push({ name: priceBreakdown.travel_fee_display_name || 'Travel Fee', amount: priceBreakdown.travel_fee_cents });
    }

    if (priceBreakdown?.surface_fee_cents && priceBreakdown.surface_fee_cents > 0) {
      fees.push({ name: 'Surface Fee (Sandbags)', amount: priceBreakdown.surface_fee_cents });
    }

    if (priceBreakdown?.same_day_pickup_fee_cents && priceBreakdown.same_day_pickup_fee_cents > 0) {
      fees.push({ name: 'Same-Day Pickup Fee', amount: priceBreakdown.same_day_pickup_fee_cents });
    }

    if (priceBreakdown?.generator_fee_cents && priceBreakdown.generator_fee_cents > 0) {
      const generatorLabel = eventDetails.generator_qty > 1
        ? `Generator (${eventDetails.generator_qty}x)`
        : 'Generator';
      fees.push({ name: generatorLabel, amount: priceBreakdown.generator_fee_cents });
    }

    const summaryDiscounts = discounts.map(discount => {
      let amount = discount.amount_cents;
      if (discount.percentage > 0) {
        amount = Math.round(subtotal * (discount.percentage / 100));
      }
      return {
        name: discount.name,
        amount: amount,
      };
    });

    const summaryCustomFees = customFees.map(fee => ({
      name: fee.name,
      amount: fee.amount_cents,
    }));

    const totalFees = fees.reduce((sum, fee) => sum + fee.amount, 0);
    const totalDiscounts = summaryDiscounts.reduce((sum, d) => sum + d.amount, 0);
    const totalCustomFees = summaryCustomFees.reduce((sum, f) => sum + f.amount, 0);

    const isMultiDay = eventDetails.event_end_date && eventDetails.event_end_date !== eventDetails.event_date;

    return {
      items,
      fees,
      discounts: summaryDiscounts,
      customFees: summaryCustomFees,
      subtotal: priceBreakdown?.subtotal_cents || subtotal,
      totalFees,
      totalDiscounts,
      totalCustomFees,
      taxableAmount,
      tax: taxCents,
      tip: 0,
      total: totalCents,
      depositDue: depositRequired,
      depositPaid: 0,
      balanceDue: totalCents - depositRequired,
      isMultiDay: !!isMultiDay,
      pickupPreference: eventDetails.pickup_preference,
    };
  }

  const orderSummary = buildOrderSummary();

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Invoice Builder</h2>
        <p className="text-sm sm:text-base text-slate-600 mb-4 sm:mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
      </div>

      {invoiceUrl && (
        <InvoiceSuccessMessage
          invoiceUrl={invoiceUrl}
          hasSelectedCustomer={!!selectedCustomer}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <CustomerSelector
            customers={customers}
            selectedCustomer={selectedCustomer}
            customerSearchQuery={customerSearchQuery}
            showDropdown={showCustomerDropdown}
            showNewCustomerForm={showNewCustomerForm}
            onSearchChange={setCustomerSearchQuery}
            onCustomerSelect={setSelectedCustomer}
            onClearCustomer={() => {
              setSelectedCustomer('');
              setCustomerSearchQuery('');
            }}
            onToggleNewForm={() => setShowNewCustomerForm(!showNewCustomerForm)}
            onShowDropdown={setShowCustomerDropdown}
          />

          {showNewCustomerForm && (
            <NewCustomerForm
              newCustomer={newCustomer}
              onChange={setNewCustomer}
              onSubmit={handleCreateNewCustomer}
              onCancel={() => setShowNewCustomerForm(false)}
            />
          )}

          <EventDetailsEditor
            editedOrder={eventDetails}
            pricingRules={pricingRules}
            onOrderChange={(updates) => setEventDetails({ ...eventDetails, ...updates })}
            onAddressSelect={(result) => {
              setEventDetails({
                ...eventDetails,
                address_line1: result.street,
                city: result.city,
                state: result.state,
                zip: result.zip,
                lat: result.lat,
                lng: result.lng,
              });
            }}
            compact={true}
            showUntilEndOfDay={true}
          />

          <CartItemsList
            cartItems={cartItems}
            units={units}
            onRemoveItem={removeItemFromCart}
            onUpdateQuantity={updateItemQuantity}
            onUpdatePrice={updateItemPrice}
            onAddUnit={addItemToCart}
          />
        </div>

        <div className="space-y-4 sm:space-y-6">
          <DiscountsManager
            discounts={discounts}
            onDiscountChange={setDiscounts}
            onMarkChanges={() => {}}
          />

          <CustomFeesManager
            customFees={customFees}
            onFeeChange={setCustomFees}
            onMarkChanges={() => {}}
          />

          <DepositOverride
            calculatedDepositCents={defaultDeposit}
            customDepositCents={customDepositCents}
            customDepositInput={customDepositInput}
            onInputChange={setCustomDepositInput}
            onApply={applyDepositOverride}
            onClear={clearDepositOverride}
            compact={true}
            showZeroHint={true}
          />

          <AdminMessageSection
            message={adminMessage}
            onChange={setAdminMessage}
          />

          {orderSummary && (
            <OrderSummary
              summary={orderSummary}
              showDeposit={true}
              showTip={false}
              title="Invoice Summary"
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
            <button
              onClick={handleGenerateInvoice}
              disabled={saving || cartItems.length === 0}
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
