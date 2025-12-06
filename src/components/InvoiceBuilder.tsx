import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, calculatePrice, calculateDrivingDistance, type PricingRules, type PriceBreakdown } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { Trash2, UserPlus, Copy, Check, Send, Search, X } from 'lucide-react';
import { AddressAutocomplete } from './AddressAutocomplete';
import { OrderSummary } from './OrderSummary';
import { type OrderSummaryDisplay } from '../lib/orderSummary';

export function InvoiceBuilder() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [newDiscount, setNewDiscount] = useState({ name: '', amount_cents: 0, percentage: 0 });
  const [discountAmountInput, setDiscountAmountInput] = useState('0.00');
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [newCustomFee, setNewCustomFee] = useState({ name: '', amount_cents: 0 });
  const [customFeeInput, setCustomFeeInput] = useState('0.00');
  const [savedDiscountTemplates, setSavedDiscountTemplates] = useState<any[]>([]);
  const [savedFeeTemplates, setSavedFeeTemplates] = useState<any[]>([]);
  const [saveDiscountAsTemplate, setSaveDiscountAsTemplate] = useState(false);
  const [saveFeeAsTemplate, setSaveFeeAsTemplate] = useState(false);
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
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
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
    loadSavedTemplates();
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

  async function loadSavedTemplates() {
    const [discountsRes, feesRes] = await Promise.all([
      supabase.from('saved_discount_templates').select('*').order('name'),
      supabase.from('saved_fee_templates').select('*').order('name'),
    ]);

    if (discountsRes.data) setSavedDiscountTemplates(discountsRes.data);
    if (feesRes.data) setSavedFeeTemplates(feesRes.data);
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

  const selectedCustomerObj = customers.find(c => c.id === selectedCustomer);

  const filteredCustomers = customers.filter(customer => {
    if (!customerSearchQuery.trim()) return true;
    const query = customerSearchQuery.toLowerCase();
    const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase();
    const email = customer.email.toLowerCase();
    const phone = customer.phone?.toLowerCase() || '';
    const businessName = customer.business_name?.toLowerCase() || '';
    return fullName.includes(query) || email.includes(query) || phone.includes(query) || businessName.includes(query);
  });

  // Calculate total discount from all discount entries
  const discountTotal = discounts.reduce((sum, d) => {
    if (d.amount_cents > 0) {
      return sum + d.amount_cents;
    } else if (d.percentage > 0) {
      return sum + Math.round(subtotal * (d.percentage / 100));
    }
    return sum;
  }, 0);

  // Calculate total custom fees
  const customFeesTotal = customFees.reduce((sum, f) => sum + f.amount_cents, 0);

  // Get automatic fees from priceBreakdown
  const travelFee = priceBreakdown?.travel_fee_cents || 0;
  const surfaceFee = priceBreakdown?.surface_fee_cents || 0;
  const sameDayPickupFee = priceBreakdown?.same_day_pickup_fee_cents || 0;
  const generatorFee = priceBreakdown?.generator_fee_cents || 0;
  const automaticFees = travelFee + surfaceFee + sameDayPickupFee + generatorFee;

  // Use priceBreakdown subtotal if available, otherwise use calculated subtotal
  const actualSubtotal = priceBreakdown?.subtotal_cents || subtotal;

  // Calculate tax on taxable amount (subtotal + automatic fees - discounts + custom fees)
  const taxableAmount = Math.max(0, actualSubtotal + automaticFees - discountTotal + customFeesTotal);
  const taxCents = Math.round(taxableAmount * 0.06);

  // Calculate total
  const totalCents = actualSubtotal + automaticFees - discountTotal + customFeesTotal + taxCents;

  // Calculate deposit - $50 per unit/item
  const defaultDeposit = cartItems.reduce((sum, item) => sum + (item.qty * 5000), 0);
  const depositRequired = customDepositCents !== null ? customDepositCents : defaultDeposit;

  async function handleCreateNewCustomer() {
    if (!newCustomer.first_name || !newCustomer.last_name || !newCustomer.email || !newCustomer.phone) {
      alert('Please fill in all required customer fields');
      return;
    }

    setSaving(true);
    try {
      // Check for duplicate phone + email combination
      const { data: existingCustomers, error: checkError } = await supabase
        .from('customers')
        .select('first_name, last_name, email, phone')
        .or(`and(email.eq.${newCustomer.email},phone.eq.${newCustomer.phone})`);

      if (checkError) throw checkError;

      if (existingCustomers && existingCustomers.length > 0) {
        const existing = existingCustomers[0];
        // Check if the name is also the same
        if (existing.first_name.toLowerCase() === newCustomer.first_name.toLowerCase() &&
            existing.last_name.toLowerCase() === newCustomer.last_name.toLowerCase()) {
          alert(`A customer with this email (${newCustomer.email}) and phone (${newCustomer.phone}) already exists with the same name.`);
          setSaving(false);
          return;
        }
        // Names are different, but email+phone match - this is not allowed
        alert(`A customer with both this email (${newCustomer.email}) AND phone number (${newCustomer.phone}) already exists. They can share one or the other, but not both unless the name is identical.`);
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
      alert('Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  function handleAddDiscount() {
    const amountCents = Math.round(parseFloat(discountAmountInput || '0') * 100);
    const percentage = parseFloat(discountPercentInput || '0');

    if (!newDiscount.name.trim()) {
      alert('Please enter a discount name');
      return;
    }

    if (amountCents === 0 && percentage === 0) {
      alert('Please enter either a dollar amount or percentage');
      return;
    }

    const discount = {
      id: crypto.randomUUID(),
      name: newDiscount.name,
      amount_cents: amountCents,
      percentage: percentage,
    };

    setDiscounts([...discounts, discount]);

    // Save as template if checkbox is checked
    if (saveDiscountAsTemplate) {
      supabase
        .from('saved_discount_templates')
        .insert({ name: discount.name, amount_cents: discount.amount_cents, percentage: discount.percentage })
        .then(() => loadSavedTemplates());
    }

    // Reset form
    setNewDiscount({ name: '', amount_cents: 0, percentage: 0 });
    setDiscountAmountInput('0.00');
    setDiscountPercentInput('0');
    setSaveDiscountAsTemplate(false);
  }

  function handleRemoveDiscount(id: string) {
    setDiscounts(discounts.filter(d => d.id !== id));
  }

  function handleAddCustomFee() {
    const amountCents = Math.round(parseFloat(customFeeInput || '0') * 100);

    if (!newCustomFee.name.trim()) {
      alert('Please enter a fee name');
      return;
    }

    if (amountCents === 0) {
      alert('Please enter a fee amount');
      return;
    }

    const fee = {
      id: crypto.randomUUID(),
      name: newCustomFee.name,
      amount_cents: amountCents,
    };

    setCustomFees([...customFees, fee]);

    // Save as template if checkbox is checked
    if (saveFeeAsTemplate) {
      supabase
        .from('saved_fee_templates')
        .insert({ name: fee.name, amount_cents: fee.amount_cents })
        .then(() => loadSavedTemplates());
    }

    // Reset form
    setNewCustomFee({ name: '', amount_cents: 0 });
    setCustomFeeInput('0.00');
    setSaveFeeAsTemplate(false);
  }

  function handleRemoveCustomFee(id: string) {
    setCustomFees(customFees.filter(f => f.id !== id));
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
      alert('Please add at least one item to the cart');
      return;
    }

    if (!eventDetails.event_date || !eventDetails.address_line1) {
      alert('Please fill in event details (date and address)');
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

      // 3. Create order
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

      // 4. Create order items
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

      // 5. Create discounts
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

      // 6. Create custom fees
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

      // 7. Send invoice
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
      alert('Failed to generate invoice: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(invoiceUrl);
    setCopiedToClipboard(true);
    setTimeout(() => setCopiedToClipboard(false), 2000);
  }

  function handleSelectCustomer(customer: any) {
    setSelectedCustomer(customer.id);
    setCustomerSearchQuery('');
    setShowCustomerDropdown(false);
  }

  function handleClearCustomer() {
    setSelectedCustomer('');
    setCustomerSearchQuery('');
    setShowCustomerDropdown(false);
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
        <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 sm:p-6">
          <div className="flex items-center mb-4">
            <Check className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 mr-2" />
            <h3 className="text-base sm:text-lg font-semibold text-green-900">Invoice Created!</h3>
          </div>
          <p className="text-sm sm:text-base text-green-800 mb-4">
            {selectedCustomer
              ? 'Invoice has been sent to the customer via email and SMS.'
              : 'Copy the link below and send it to your customer to fill in their information and accept the invoice.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={invoiceUrl}
              readOnly
              className="flex-1 px-3 sm:px-4 py-2 border border-green-300 rounded-lg bg-white text-slate-900 text-sm"
            />
            <button
              onClick={handleCopyLink}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors whitespace-nowrap text-sm sm:text-base"
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
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">Select Customer</h3>
              <button
                onClick={() => setShowNewCustomerForm(!showNewCustomerForm)}
                className="flex items-center justify-center gap-1 sm:gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm rounded-lg transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                New Customer
              </button>
            </div>

            {selectedCustomerObj ? (
              <div className="mb-3">
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div>
                    <p className="font-medium text-slate-900">
                      {selectedCustomerObj.first_name} {selectedCustomerObj.last_name}
                    </p>
                    <p className="text-sm text-slate-600">{selectedCustomerObj.email}</p>
                    {selectedCustomerObj.business_name && (
                      <p className="text-sm text-slate-600">{selectedCustomerObj.business_name}</p>
                    )}
                  </div>
                  <button
                    onClick={handleClearCustomer}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative mb-3 customer-search-container">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search customers by name, email, phone, or business..."
                    value={customerSearchQuery}
                    onChange={(e) => {
                      setCustomerSearchQuery(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {showCustomerDropdown && filteredCustomers.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredCustomers.slice(0, 50).map(customer => (
                      <button
                        key={customer.id}
                        onClick={() => handleSelectCustomer(customer)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-slate-100 last:border-b-0 transition-colors"
                      >
                        <p className="font-medium text-slate-900">
                          {customer.first_name} {customer.last_name}
                          {customer.business_name && <span className="text-slate-600 ml-2">({customer.business_name})</span>}
                        </p>
                        <p className="text-sm text-slate-600">{customer.email}</p>
                        {customer.phone && <p className="text-sm text-slate-600">{customer.phone}</p>}
                      </button>
                    ))}
                    {filteredCustomers.length > 50 && (
                      <div className="px-4 py-2 text-sm text-slate-500 bg-slate-50">
                        Showing first 50 results. Type to refine your search.
                      </div>
                    )}
                  </div>
                )}
                {showCustomerDropdown && customerSearchQuery && filteredCustomers.length === 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg p-4 text-center text-slate-500">
                    No customers found matching "{customerSearchQuery}"
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-slate-500 mt-2">
              Leave blank to generate a shareable link for customer to fill in their details
            </p>

            {showNewCustomerForm && (
              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <h4 className="font-medium text-slate-900 mb-3">Create New Customer</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Event Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Start Time *</label>
                  <input
                    type="time"
                    value={eventDetails.start_window}
                    onChange={(e) => setEventDetails({ ...eventDetails, start_window: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">End Time *</label>
                  <input
                    type="time"
                    value={eventDetails.end_window}
                    onChange={(e) => setEventDetails({ ...eventDetails, end_window: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  {((eventDetails.location_type === 'residential' && eventDetails.pickup_preference === 'same_day') || eventDetails.location_type === 'commercial') && (
                    <p className="text-xs text-slate-600 mt-1">Max 7:00 PM for same-day pickup</p>
                  )}
                  <div className="mt-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={eventDetails.until_end_of_day}
                        onChange={(e) =>
                          setEventDetails({
                            ...eventDetails,
                            until_end_of_day: e.target.checked,
                          })
                        }
                        disabled={(eventDetails.location_type === 'residential' && eventDetails.pickup_preference === 'same_day') || eventDetails.location_type === 'commercial'}
                        className="mr-2 disabled:opacity-50"
                      />
                      <span className={((eventDetails.location_type === 'residential' && eventDetails.pickup_preference === 'same_day') || eventDetails.location_type === 'commercial') ? 'opacity-50' : ''}>
                        Until end of day
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Street Address *</label>
                <AddressAutocomplete
                  value={eventDetails.address_line1}
                  onSelect={(address) => {
                    setEventDetails({
                      ...eventDetails,
                      address_line1: address.street,
                      city: address.city,
                      state: address.state,
                      zip: address.zip,
                      lat: address.lat,
                      lng: address.lng,
                    });
                  }}
                  placeholder="Enter street address"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <label className="block text-sm font-medium text-slate-700 mb-2">Event Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEventDetails({ ...eventDetails, location_type: 'residential' })}
                    className={`px-4 py-3 rounded-lg border-2 transition-all text-center ${
                      eventDetails.location_type === 'residential'
                        ? 'border-green-600 bg-green-50 text-green-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-sm">Residential</div>
                    <div className="text-xs mt-1 opacity-80">Home, backyard</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventDetails({ ...eventDetails, location_type: 'commercial' })}
                    className={`px-4 py-3 rounded-lg border-2 transition-all text-center ${
                      eventDetails.location_type === 'commercial'
                        ? 'border-blue-600 bg-blue-50 text-blue-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-sm">Commercial</div>
                    <div className="text-xs mt-1 opacity-80">School, park, church</div>
                  </button>
                </div>
                {eventDetails.location_type === 'commercial' && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-900">
                      <strong>Commercial events require same-day pickup by 7:00 PM.</strong> This ensures safety at parks, churches, schools, and other public locations.
                    </p>
                  </div>
                )}
              </div>

              {eventDetails.location_type === 'residential' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">When do you need pickup?</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEventDetails({ ...eventDetails, pickup_preference: 'next_day', same_day_responsibility_accepted: false, overnight_responsibility_accepted: false })}
                      className={`px-4 py-3 rounded-lg border-2 transition-all text-left ${
                        eventDetails.pickup_preference === 'next_day'
                          ? 'border-green-600 bg-green-50 text-green-900'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <div className="font-semibold text-sm">Next Morning</div>
                      <div className="text-xs mt-1 opacity-80">Pickup 6 AM - 1:30 PM</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEventDetails({ ...eventDetails, pickup_preference: 'same_day' })}
                      className={`px-4 py-3 rounded-lg border-2 transition-all text-left ${
                        eventDetails.pickup_preference === 'same_day'
                          ? 'border-orange-600 bg-orange-50 text-orange-900'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <div className="font-semibold text-sm">Same Day</div>
                      <div className="text-xs mt-1 opacity-80">Additional fees apply</div>
                    </button>
                  </div>
                  {eventDetails.pickup_preference === 'next_day' && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-900">
                        <strong>Note:</strong> Customer will accept overnight responsibility terms when viewing the invoice.
                      </p>
                    </div>
                  )}
                  {eventDetails.pickup_preference === 'same_day' && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-900">
                        <strong>Note:</strong> Customer will accept same-day pickup terms when viewing the invoice.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Setup Surface</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEventDetails({ ...eventDetails, surface: 'grass' })}
                    className={`px-4 py-3 rounded-lg border-2 transition-all text-center font-medium ${
                      eventDetails.surface === 'grass'
                        ? 'border-green-500 bg-green-50 text-green-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    Grass (stakes)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventDetails({ ...eventDetails, surface: 'cement' })}
                    className={`px-4 py-3 rounded-lg border-2 transition-all text-center font-medium ${
                      eventDetails.surface === 'cement'
                        ? 'border-green-500 bg-green-50 text-green-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    Sandbags
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Generator Quantity</label>
                <input
                  type="number"
                  min="0"
                  value={eventDetails.generator_qty}
                  onChange={(e) => setEventDetails({ ...eventDetails, generator_qty: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="0"
                />
                {eventDetails.generator_qty > 0 && pricingRules && (
                  <p className="text-xs text-slate-600 mt-2">
                    Generator fee: {formatCurrency(pricingRules.generator_price_cents * eventDetails.generator_qty)}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Available Units</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {units.filter(unit => {
                // Check if this unit is already in the cart
                const existingItem = cartItems.find(item => item.unit_id === unit.id);

                if (!existingItem) {
                  // Unit not in cart, so it's available to add
                  return true;
                }

                // Unit is in cart - only show if we have multiple units in inventory
                return (unit.quantity_available || 1) > 1;
              }).map(unit => (
                <div key={unit.id} className="border border-slate-200 rounded-lg p-3">
                  <p className="font-medium text-slate-900 text-sm">
                    {unit.name}
                    {(unit.quantity_available || 1) > 1 && (
                      <span className="ml-2 text-xs text-slate-600">({unit.quantity_available} available)</span>
                    )}
                  </p>
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
              {units.filter(unit => {
                const existingItem = cartItems.find(item => item.unit_id === unit.id);
                if (!existingItem) return true;
                return (unit.quantity_available || 1) > 1;
              }).length === 0 && (
                <div className="col-span-2 text-center py-6 text-slate-500">
                  All available units have been added to this invoice
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Cart Items</h3>
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
                        <label className="block text-xs text-slate-600 mb-1">Qty</label>
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

        <div className="space-y-4 sm:space-y-6">
          {/* Discounts Section */}
          <div className="bg-green-50 rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Discounts</h3>

            {/* Existing Discounts */}
            {discounts.length > 0 && (
              <div className="mb-4 space-y-2">
                {discounts.map((discount) => (
                  <div key={discount.id} className="flex items-center justify-between bg-white p-3 rounded border border-green-200">
                    <div>
                      <p className="font-medium text-slate-900">{discount.name}</p>
                      <p className="text-sm text-slate-600">
                        {discount.amount_cents > 0 && `-${formatCurrency(discount.amount_cents)}`}
                        {discount.percentage > 0 && `${discount.percentage}%`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveDiscount(discount.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Discount Form */}
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Discount name"
                value={newDiscount.name}
                onChange={(e) => setNewDiscount({ ...newDiscount, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">$ Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountAmountInput}
                    onChange={(e) => setDiscountAmountInput(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">% Percentage</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={discountPercentInput}
                    onChange={(e) => setDiscountPercentInput(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
              <label className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={saveDiscountAsTemplate}
                  onChange={(e) => setSaveDiscountAsTemplate(e.target.checked)}
                  className="mr-2"
                />
                Save this discount for future use
              </label>
              <button
                onClick={handleAddDiscount}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm transition-colors"
              >
                Add Discount
              </button>
            </div>
          </div>

          {/* Custom Fees Section */}
          <div className="bg-blue-50 rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4">Custom Fees</h3>

            {/* Existing Fees */}
            {customFees.length > 0 && (
              <div className="mb-4 space-y-2">
                {customFees.map((fee) => (
                  <div key={fee.id} className="flex items-center justify-between bg-white p-3 rounded border border-blue-200">
                    <div>
                      <p className="font-medium text-slate-900">{fee.name}</p>
                      <p className="text-sm text-slate-600">{formatCurrency(fee.amount_cents)}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveCustomFee(fee.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Fee Form */}
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Fee name (e.g., Tip, Setup Fee, etc.)"
                value={newCustomFee.name}
                onChange={(e) => setNewCustomFee({ ...newCustomFee, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <div>
                <label className="block text-xs text-slate-600 mb-1">$ Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customFeeInput}
                  onChange={(e) => setCustomFeeInput(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="0.00"
                />
              </div>
              <label className="flex items-center text-sm">
                <input
                  type="checkbox"
                  checked={saveFeeAsTemplate}
                  onChange={(e) => setSaveFeeAsTemplate(e.target.checked)}
                  className="mr-2"
                />
                Save this fee for future use
              </label>
              <button
                onClick={handleAddCustomFee}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm transition-colors"
              >
                Add Custom Fee
              </button>
            </div>
          </div>

          {/* Deposit Override Section */}
          <div className="bg-amber-50 rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">Deposit Override</h3>
            <p className="text-sm text-slate-600 mb-4">
              Set a custom deposit amount. Use this when the calculated deposit doesn't match your requirements.
            </p>
            <div className="bg-white p-3 rounded border border-amber-200 mb-3">
              <p className="text-sm text-slate-700">
                <strong>Calculated Deposit:</strong> {formatCurrency(defaultDeposit)}
              </p>
            </div>
            {customDepositCents === null ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Custom Deposit Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-600">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customDepositInput}
                      onChange={(e) => setCustomDepositInput(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Set to $0 for acceptance-only invoices (no payment required)
                  </p>
                </div>
                <button
                  onClick={applyDepositOverride}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm transition-colors"
                >
                  Apply
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-white p-3 rounded border border-amber-200">
                  <p className="text-sm text-slate-700">
                    <strong>Custom Deposit:</strong> {formatCurrency(customDepositCents)}
                  </p>
                  {customDepositCents === 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      Customer will only need to accept (no payment required)
                    </p>
                  )}
                </div>
                <button
                  onClick={clearDepositOverride}
                  className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 py-2 rounded-lg text-sm transition-colors"
                >
                  Clear Override
                </button>
              </div>
            )}
          </div>

          {/* Message to Customer */}
          <div className="bg-slate-50 rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">Message to Customer</h3>
            <p className="text-sm text-slate-600 mb-4">
              Add an optional message to explain the changes to the customer. This will be included in the email and text notification.
            </p>
            <textarea
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              rows={4}
              placeholder="Example: We're upgrading your bounce house to a larger unit at no extra charge! Also added a generator since your event location doesn't have power outlets nearby."
            />
          </div>

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
