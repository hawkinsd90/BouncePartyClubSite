import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency, calculateDrivingDistance } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { FileText, Image as ImageIcon, AlertCircle, Sparkles, Shield, Loader2, Printer, X, CreditCard, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import WaiverTab from '../components/WaiverTab';
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';
import { OrderSummary } from '../components/OrderSummary';
import { PrintableInvoice } from '../components/PrintableInvoice';
import { showToast } from '../lib/notifications';
import { ApprovalModal } from '../components/customer-portal/ApprovalModal';
import { RejectionModal } from '../components/customer-portal/RejectionModal';
import { PaymentTab } from '../components/customer-portal/PaymentTab';
import { PicturesTab } from '../components/customer-portal/PicturesTab';
import { RentalTerms } from '../components/RentalTerms';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const isInvoiceLink = location.pathname.startsWith('/invoice/');
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'waiver' | 'payment' | 'pictures'>('waiver');
  const [approvalSuccess, setApprovalSuccess] = useState(false);
  const [changelog, setChangelog] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [invoiceLink, setInvoiceLink] = useState<any>(null);
  const [customerInfo, setCustomerInfo] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [orderSummary, setOrderSummary] = useState<OrderSummaryDisplay | null>(null);
  const [overnightResponsibilityAccepted, setOvernightResponsibilityAccepted] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<'deposit' | 'full' | 'custom'>('deposit');
  const [customPaymentAmount, setCustomPaymentAmount] = useState('');
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    setLoading(true);
    try {
      let orderIdToLoad = orderId;

      // If accessing via invoice token, load the invoice link first
      if (isInvoiceLink && token) {
        const { data: linkData, error: linkError } = await supabase
          .from('invoice_links')
          .select('*')
          .eq('link_token', token)
          .maybeSingle();

        if (linkError || !linkData) {
          setLoading(false);
          return;
        }

        if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
          setLoading(false);
          return;
        }

        setInvoiceLink(linkData);
        orderIdToLoad = linkData.order_id;
      }

      if (!orderIdToLoad) {
        console.error('No order ID provided');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*)
        `)
        .eq('id', orderIdToLoad)
        .single();

      if (error) {
        console.error('Error loading order:', error);
        setLoading(false);
        return;
      }

      if (data) {
        // Pre-fill customer info if available
        const customer = data.customers as any;
        if (customer) {
          setCustomerInfo({
            first_name: customer.first_name || '',
            last_name: customer.last_name || '',
            email: customer.email || '',
            phone: customer.phone || '',
            business_name: customer.business_name || '',
          });
        }

        // Calculate travel miles on-the-fly if missing
        let travelMiles = data.travel_total_miles || 0;
        if (travelMiles === 0 && data.travel_fee_cents > 0 && data.addresses) {
          try {
            const addr = data.addresses as any;
            const lat = parseFloat(addr.lat);
            const lng = parseFloat(addr.lng);
            if (lat && lng) {
              travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);
              // Save it back to database for next time
              if (travelMiles > 0) {
                supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', data.id);
                data.travel_total_miles = travelMiles;
              }
            }
          } catch (error) {
            console.error('Error calculating travel distance:', error);
          }
        }

        setOrder(data);
        if (data.waiver_signed_at) {
          setActiveTab('payment');
        }

        // Load changelog if status is awaiting approval or pending review
        if (data.status === 'awaiting_customer_approval' || data.status === 'pending_review') {
          const { data: changelogData } = await supabase
            .from('order_changelog')
            .select('*')
            .eq('order_id', orderIdToLoad)
            .order('created_at', { ascending: false });

          if (changelogData) {
            setChangelog(changelogData);
          }
        }

        // Load order items, discounts, and custom fees
        const { data: itemsData } = await supabase
          .from('order_items')
          .select('*, units(name)')
          .eq('order_id', orderIdToLoad);

        const { data: discountsData } = await supabase
          .from('order_discounts')
          .select('*')
          .eq('order_id', orderIdToLoad);

        const { data: feesData } = await supabase
          .from('order_custom_fees')
          .select('*')
          .eq('order_id', orderIdToLoad);

        if (itemsData) setOrderItems(itemsData);
        if (discountsData && discountsData.length > 0) {
          console.log('Loaded discounts:', discountsData);
          setDiscounts(discountsData);
        }
        if (feesData && feesData.length > 0) {
          console.log('Loaded custom fees:', feesData);
          setCustomFees(feesData);
        }

        // Recalculate pricing with discounts and custom fees
        if (data && ((discountsData && discountsData.length > 0) || (feesData && feesData.length > 0))) {
          const discountTotal = (discountsData || []).reduce((sum: number, d: any) => {
            if (d.amount_cents > 0) {
              return sum + d.amount_cents;
            } else if (d.percentage > 0) {
              const taxableBase = data.subtotal_cents + (data.generator_fee_cents || 0) + data.travel_fee_cents + data.surface_fee_cents;
              return sum + Math.round(taxableBase * (d.percentage / 100));
            }
            return sum;
          }, 0);

          const customFeesTotal = (feesData || []).reduce((sum: number, f: any) => sum + f.amount_cents, 0);

          // Recalculate tax with discounts and custom fees
          const taxableAmount = Math.max(0,
            data.subtotal_cents +
            (data.generator_fee_cents || 0) +
            data.travel_fee_cents +
            data.surface_fee_cents +
            customFeesTotal -
            discountTotal
          );
          const recalculatedTax = Math.round(taxableAmount * 0.06);

          // Recalculate total
          const recalculatedTotal =
            data.subtotal_cents +
            (data.generator_fee_cents || 0) +
            data.travel_fee_cents +
            data.surface_fee_cents +
            (data.same_day_pickup_fee_cents || 0) +
            customFeesTotal +
            recalculatedTax +
            (data.tip_cents || 0) -
            discountTotal;

          console.log('Rendering price breakdown:');
          console.log('- Discounts:', discountsData);
          console.log('- Custom Fees:', feesData);
          console.log('- Order Items:', itemsData);

          // Update the order object with recalculated values
          setOrder({
            ...data,
            tax_cents: recalculatedTax,
            deposit_due_cents: data.deposit_due_cents,
            balance_due_cents: recalculatedTotal - data.deposit_due_cents,
          });
        }

        // Load centralized order summary
        const summaryData = await loadOrderSummary(orderIdToLoad);
        if (summaryData) {
          const formattedSummary = formatOrderSummary(summaryData);
          setOrderSummary(formattedSummary);
        }
      }
    } catch (error) {
      console.error('Error loading order:', error);
    } finally {
      setLoading(false);
    }
  }


  async function handlePayment() {
    showToast('Payment processing will be implemented with Stripe integration', 'info');
  }

  const handlePrintInvoice = () => {
    window.print();
  };

  const prepareInvoiceData = () => {
    if (!order) return null;

    const quoteData = {
      event_date: order.event_date,
      start_window: order.start_window,
      address_line1: order.addresses?.line1 || '',
      address_line2: order.addresses?.line2 || '',
      city: order.addresses?.city || '',
      state: order.addresses?.state || '',
      zip: order.addresses?.zip || '',
      location_type: order.location_type,
    };

    const totalCents = order.subtotal_cents +
                       (order.generator_fee_cents || 0) +
                       order.travel_fee_cents +
                       order.surface_fee_cents +
                       (order.same_day_pickup_fee_cents || 0) +
                       order.tax_cents +
                       (order.tip_cents || 0);

    const discountTotal = discounts.reduce((sum: number, d: any) => {
      if (d.amount_cents > 0) {
        return sum + d.amount_cents;
      } else if (d.percentage > 0) {
        const taxableBase = order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents;
        return sum + Math.round(taxableBase * (d.percentage / 100));
      }
      return sum;
    }, 0);

    const customFeesTotal = customFees.reduce((sum: number, f: any) => sum + f.amount_cents, 0);

    const priceBreakdown = {
      subtotal_cents: order.subtotal_cents,
      travel_fee_cents: order.travel_fee_cents,
      travel_fee_display_name: order.travel_total_miles ? `Travel Fee (${order.travel_total_miles.toFixed(1)} mi)` : 'Travel Fee',
      surface_fee_cents: order.surface_fee_cents,
      same_day_pickup_fee_cents: order.same_day_pickup_fee_cents || 0,
      generator_fee_cents: order.generator_fee_cents || 0,
      discount_cents: discountTotal,
      custom_fees_cents: customFeesTotal,
      tax_cents: order.tax_cents,
      tip_cents: order.tip_cents || 0,
      total_cents: totalCents - discountTotal + customFeesTotal,
      deposit_due_cents: order.deposit_due_cents,
      balance_due_cents: order.balance_due_cents,
    };

    const cart = orderItems.map((item: any) => ({
      unit_id: item.unit_id,
      unit_name: item.units?.name || 'Unknown Unit',
      wet_or_dry: item.wet_or_dry,
      unit_price_cents: item.unit_price_cents * item.qty,
      qty: item.qty,
    }));

    const contactData = {
      first_name: order.customers?.first_name || customerInfo.first_name,
      last_name: order.customers?.last_name || customerInfo.last_name,
      email: order.customers?.email || customerInfo.email,
      phone: order.customers?.phone || customerInfo.phone,
      business_name: order.customers?.business_name || customerInfo.business_name,
    };

    return { quoteData, priceBreakdown, cart, contactData };
  };

  async function handleSubmitPictures(_images: string[], _notes: string) {
    try {
      showToast('Picture submission feature coming soon - images will be stored in Supabase Storage', 'info');
    } catch (error) {
      console.error('Error submitting pictures:', error);
      showToast('Failed to submit pictures', 'error');
      throw error;
    }
  }

  async function handleAcceptInvoice() {
    if (!cardOnFileConsent || !smsConsent) {
      showToast('Please accept both authorization and consent terms', 'error');
      return;
    }

    // If customer info not filled, require it
    if (invoiceLink && !invoiceLink.customer_filled && (!customerInfo.first_name || !customerInfo.last_name || !customerInfo.email || !customerInfo.phone)) {
      showToast('Please fill in all required customer information', 'error');
      return;
    }

    setProcessing(true);

    try {
      // If customer info was provided and not already in DB, create customer
      let customerId = order.customer_id;

      if (invoiceLink && !invoiceLink.customer_filled && customerInfo.email) {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert([customerInfo])
          .select()
          .single();

        if (customerError) throw customerError;
        customerId = newCustomer.id;

        // Update order with customer ID
        await supabase
          .from('orders')
          .update({
            customer_id: customerId,
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        // Mark invoice link as customer filled
        await supabase
          .from('invoice_links')
          .update({ customer_filled: true })
          .eq('id', invoiceLink.id);
      } else {
        // Just update consent flags
        await supabase
          .from('orders')
          .update({
            card_on_file_consent: cardOnFileConsent,
            sms_consent: smsConsent,
            invoice_accepted_at: new Date().toISOString(),
          })
          .eq('id', order.id);
      }

      // Calculate payment amount based on selection
      let actualPaymentCents = 0;
      const totalCents = order.deposit_due_cents + order.balance_due_cents;

      if (paymentAmount === 'deposit') {
        actualPaymentCents = order.deposit_due_cents;
      } else if (paymentAmount === 'full') {
        actualPaymentCents = totalCents;
      } else if (paymentAmount === 'custom' && customPaymentAmount) {
        actualPaymentCents = Math.round(parseFloat(customPaymentAmount) * 100);
        // Ensure it's at least the minimum deposit
        if (actualPaymentCents < order.deposit_due_cents) {
          showToast(`Payment amount must be at least ${formatCurrency(order.deposit_due_cents)}`, 'error');
          setProcessing(false);
          return;
        }
      } else {
        showToast('Please select a payment amount', 'error');
        setProcessing(false);
        return;
      }

      // Calculate tip amount based on selection
      let tipCents = 0;
      if (tipAmount === '10') {
        tipCents = Math.round(totalCents * 0.1);
      } else if (tipAmount === '15') {
        tipCents = Math.round(totalCents * 0.15);
      } else if (tipAmount === '20') {
        tipCents = Math.round(totalCents * 0.2);
      } else if (tipAmount === 'custom' && customTipAmount) {
        tipCents = Math.round(parseFloat(customTipAmount) * 100);
      }

      // Update order with tip if provided
      if (tipCents > 0) {
        await supabase
          .from('orders')
          .update({ tip_cents: tipCents })
          .eq('id', order.id);
      }

      // If payment is $0, just mark as accepted
      if (actualPaymentCents === 0) {
        await supabase
          .from('orders')
          .update({
            status: 'awaiting_customer_approval',
          })
          .eq('id', order.id);

        showToast('Invoice accepted! You will receive a confirmation shortly.', 'success');
        window.location.reload();
        return;
      }

      // Otherwise, proceed to payment
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orderId: order.id,
            depositCents: actualPaymentCents,
            tipCents: tipCents,
            customerEmail: customerInfo.email || order.customers?.email,
            customerName: customerInfo.first_name ? `${customerInfo.first_name} ${customerInfo.last_name}` : `${order.customers?.first_name} ${order.customers?.last_name}`,
            origin: window.location.origin,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err: any) {
      console.error('Error accepting invoice:', err);
      showToast('Failed to process invoice: ' + err.message, 'error');
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900">Order Not Found</h1>
          <p className="text-slate-600 mt-2">The order you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  const balanceDue = order.balance_due_cents - (order.balance_paid_cents || 0);
  const needsWaiver = !order.waiver_signed_at;
  const needsPayment = balanceDue > 0;
  const needsApproval = order.status === 'awaiting_customer_approval';
  const isActive = ['confirmed', 'in_progress', 'completed'].includes(order.status);

  async function handleApproveChanges() {
    setShowApproveModal(true);
  }

  async function handleRejectChanges() {
    setShowRejectModal(true);
  }

  // Show success screen after approval
  if (approvalSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-2xl w-full bg-white rounded-xl shadow-2xl overflow-hidden border-4 border-green-500">
          <div className="bg-white px-8 py-6 text-center border-b-4 border-green-500">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-20 w-auto mx-auto mb-4"
            />
            <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-green-900">Approval Received!</h1>
          </div>

          <div className="px-8 py-8 text-center">
            <p className="text-lg text-slate-700 mb-6">
              Thank you for approving the changes to your order <strong>#{order.id.slice(0, 8).toUpperCase()}</strong>.
            </p>

            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
              <h3 className="font-bold text-blue-900 mb-2">What happens next?</h3>
              <ul className="text-left text-blue-800 space-y-2 text-sm">
                <li>• Our team will review your approval and finalize the booking details</li>
                <li>• You'll receive a confirmation once everything is ready</li>
                <li>• We'll send you instructions for signing the waiver and payment</li>
                <li>• Contact us at (313) 889-3860 if you have any questions</li>
              </ul>
            </div>

            <p className="text-slate-600">
              You can safely close this window. We'll be in touch soon!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // If order is not active and not awaiting approval, show status message or invoice acceptance
  if (!isActive && !needsApproval) {
    // Show invoice acceptance for draft orders (regardless of URL)
    if (order.status === 'draft') {
      const needsCustomerInfo = invoiceLink && !invoiceLink.customer_filled;

      return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-md p-8 mb-6">
              <div className="text-center mb-8">
                <img
                  src="/bounce party club logo.png"
                  alt="Bounce Party Club"
                  className="h-20 w-auto mx-auto mb-4"
                />
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Invoice from Bounce Party Club</h1>
                <p className="text-slate-600">Review and accept your order details below</p>
              </div>

              <div className="mb-8 p-6 bg-slate-50 rounded-lg">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Event Details</h2>
                <div className="space-y-2 text-sm">
                  <p><strong>Date:</strong> {order.event_date}</p>
                  <p><strong>Time:</strong> {order.start_window} - {order.end_window}</p>
                  <p><strong>Location:</strong> {order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}</p>
                  <p><strong>Location Type:</strong> <span className="capitalize">{order.location_type}</span></p>
                </div>
              </div>

              <div className="mb-8">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Order Items</h2>
                <div className="space-y-3">
                  {orderItems.map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-medium text-slate-900">{item.units?.name}</p>
                        <p className="text-sm text-slate-600 capitalize">
                          {item.wet_or_dry === 'water' ? 'Water Mode' : 'Dry Mode'} × {item.qty}
                        </p>
                      </div>
                      <p className="font-semibold text-slate-900">
                        {formatCurrency(item.unit_price_cents * item.qty)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {orderSummary && (
                <div className="mb-8">
                  <OrderSummary
                    summary={orderSummary}
                    showDeposit={true}
                    showTip={orderSummary.tip > 0}
                    title="Complete Price Breakdown"
                  />
                  <button
                    type="button"
                    onClick={() => setShowInvoiceModal(true)}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mt-4"
                  >
                    <FileText className="w-5 h-5 mr-2" />
                    View as Invoice / Print PDF
                  </button>
                </div>
              )}

              {/* Payment Amount Selection */}
              <div className="mb-8">
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center">
                  <CreditCard className="w-5 h-5 mr-2 text-green-600" />
                  Payment Amount
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    paymentAmount === 'deposit' ? 'border-blue-600 bg-blue-50' : 'border-slate-300 hover:border-blue-400'
                  }`}>
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="deposit"
                      checked={paymentAmount === 'deposit'}
                      onChange={(e) => setPaymentAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Minimum Deposit</span>
                    <span className="text-lg font-bold text-blue-600 mt-1">
                      {formatCurrency(order.deposit_due_cents)}
                    </span>
                    <span className="text-xs text-slate-600 mt-1">Pay balance at event</span>
                  </label>

                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    paymentAmount === 'full' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                  }`}>
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="full"
                      checked={paymentAmount === 'full'}
                      onChange={(e) => setPaymentAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Full Payment</span>
                    <span className="text-lg font-bold text-green-600 mt-1">
                      {formatCurrency(order.deposit_due_cents + order.balance_due_cents)}
                    </span>
                    <span className="text-xs text-slate-600 mt-1">Nothing due at event</span>
                  </label>

                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    paymentAmount === 'custom' ? 'border-purple-600 bg-purple-50' : 'border-slate-300 hover:border-purple-400'
                  }`}>
                    <input
                      type="radio"
                      name="paymentAmount"
                      value="custom"
                      checked={paymentAmount === 'custom'}
                      onChange={(e) => setPaymentAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">Custom Amount</span>
                    <span className="text-sm text-slate-600 mt-1">Choose your amount</span>
                  </label>
                </div>

                {paymentAmount === 'custom' && (
                  <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Payment Amount * (Minimum: {formatCurrency(order.deposit_due_cents)})
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-slate-600">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min={(order.deposit_due_cents / 100).toFixed(2)}
                        max={((order.deposit_due_cents + order.balance_due_cents) / 100).toFixed(2)}
                        value={customPaymentAmount}
                        onChange={(e) => setCustomPaymentAmount(e.target.value)}
                        placeholder={(order.deposit_due_cents / 100).toFixed(2)}
                        className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      Enter any amount between the minimum deposit and the full total
                    </p>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900 font-medium">
                    {paymentAmount === 'deposit' && `Pay ${formatCurrency(order.deposit_due_cents)} now, ${formatCurrency(order.balance_due_cents)} at event`}
                    {paymentAmount === 'full' && `Pay ${formatCurrency(order.deposit_due_cents + order.balance_due_cents)} now, nothing at event`}
                    {paymentAmount === 'custom' && customPaymentAmount && `Pay $${customPaymentAmount} now, ${formatCurrency((order.deposit_due_cents + order.balance_due_cents) - Math.round(parseFloat(customPaymentAmount) * 100))} at event`}
                    {paymentAmount === 'custom' && !customPaymentAmount && 'Enter amount to see payment breakdown'}
                  </p>
                </div>
              </div>

              {/* Tip Selection */}
              <div className="mb-8">
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center">
                  <Sparkles className="w-5 h-5 mr-2 text-amber-600" />
                  Add Tip for Crew
                </h2>
                <p className="text-slate-600 mb-4 text-sm">
                  Show your appreciation for our crew! Tips are optional but greatly appreciated.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    tipAmount === 'none' ? 'border-slate-600 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
                  }`}>
                    <input
                      type="radio"
                      name="tipAmount"
                      value="none"
                      checked={tipAmount === 'none'}
                      onChange={(e) => setTipAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">No Tip</span>
                    <span className="text-sm text-slate-600 mt-1">$0.00</span>
                  </label>

                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    tipAmount === '10' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                  }`}>
                    <input
                      type="radio"
                      name="tipAmount"
                      value="10"
                      checked={tipAmount === '10'}
                      onChange={(e) => setTipAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">10%</span>
                    <span className="text-sm text-green-600 mt-1">
                      {formatCurrency(Math.round((order.deposit_due_cents + order.balance_due_cents) * 0.1))}
                    </span>
                  </label>

                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    tipAmount === '15' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                  }`}>
                    <input
                      type="radio"
                      name="tipAmount"
                      value="15"
                      checked={tipAmount === '15'}
                      onChange={(e) => setTipAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">15%</span>
                    <span className="text-sm text-green-600 mt-1">
                      {formatCurrency(Math.round((order.deposit_due_cents + order.balance_due_cents) * 0.15))}
                    </span>
                  </label>

                  <label className={`relative flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    tipAmount === '20' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                  }`}>
                    <input
                      type="radio"
                      name="tipAmount"
                      value="20"
                      checked={tipAmount === '20'}
                      onChange={(e) => setTipAmount(e.target.value as any)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-slate-900">20%</span>
                    <span className="text-sm text-green-600 mt-1">
                      {formatCurrency(Math.round((order.deposit_due_cents + order.balance_due_cents) * 0.2))}
                    </span>
                  </label>
                </div>

                <label className={`relative flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all mb-4 ${
                  tipAmount === 'custom' ? 'border-green-600 bg-green-50' : 'border-slate-300 hover:border-green-400'
                }`}>
                  <input
                    type="radio"
                    name="tipAmount"
                    value="custom"
                    checked={tipAmount === 'custom'}
                    onChange={(e) => setTipAmount(e.target.value as any)}
                    className="sr-only"
                  />
                  <span className="font-semibold text-slate-900 flex-grow">Custom Amount</span>
                  {tipAmount === 'custom' && (
                    <div className="relative ml-4">
                      <span className="absolute left-3 top-2 text-slate-600">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customTipAmount}
                        onChange={(e) => setCustomTipAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-32 pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                </label>

                {tipAmount !== 'none' && (tipAmount !== 'custom' || customTipAmount) && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm text-green-900 font-medium">
                      {tipAmount === 'custom'
                        ? `Thank you for tipping $${customTipAmount}! Your crew will greatly appreciate it.`
                        : `Thank you for tipping ${formatCurrency(Math.round((order.deposit_due_cents + order.balance_due_cents) * (parseInt(tipAmount) / 100)))}! Your crew will greatly appreciate it.`
                      }
                    </p>
                  </div>
                )}
              </div>

              {needsCustomerInfo && (
                <div className="mb-8">
                  <h2 className="text-xl font-bold text-slate-900 mb-4">Your Information</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">First Name *</label>
                      <input
                        type="text"
                        required
                        value={customerInfo.first_name}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, first_name: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Last Name *</label>
                      <input
                        type="text"
                        required
                        value={customerInfo.last_name}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, last_name: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Email *</label>
                      <input
                        type="email"
                        required
                        value={customerInfo.email}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Phone *</label>
                      <input
                        type="tel"
                        required
                        value={customerInfo.phone}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                        placeholder="(313) 555-0123"
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-2">Business Name (Optional)</label>
                      <input
                        type="text"
                        value={customerInfo.business_name}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, business_name: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-8">
                <RentalTerms />
              </div>

              <div className="mb-8 space-y-4">
                {order.pickup_preference === 'next_day' && (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                    <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                      <AlertCircle className="w-5 h-5 mr-2 text-amber-600" />
                      Overnight Responsibility Agreement
                    </h3>
                    <p className="text-sm text-slate-700 mb-3">
                      For next-day pickup rentals, you are responsible for the equipment left on your property overnight.
                    </p>
                    <label className="flex items-start cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overnightResponsibilityAccepted}
                        onChange={(e) => setOvernightResponsibilityAccepted(e.target.checked)}
                        className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                        required
                      />
                      <span className="ml-3 text-sm text-slate-700">
                        ⚠️ I understand the inflatable will remain on my property overnight and I am legally responsible for its safety and security until pickup the next morning. *
                      </span>
                    </label>
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
                    <Shield className="w-5 h-5 mr-2 text-green-600" />
                    Card-on-File Authorization
                  </h3>
                  <p className="text-sm text-slate-700 mb-3">
                    I authorize Bounce Party Club LLC to securely store my payment method and charge it for incidentals including damage, excess cleaning, or late fees as itemized in a receipt. I understand that any charges will be accompanied by photographic evidence and a detailed explanation.
                  </p>
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cardOnFileConsent}
                      onChange={(e) => setCardOnFileConsent(e.target.checked)}
                      className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                      required
                    />
                    <span className="ml-3 text-sm text-slate-700">
                      I have read and agree to the card-on-file authorization terms above. *
                    </span>
                  </label>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">SMS Notifications Consent</h3>
                  <p className="text-sm text-slate-700 mb-3">
                    By providing my phone number and checking the box below, I consent to receive transactional SMS text messages from Bounce Party Club LLC at the phone number provided. These messages may include order confirmations, delivery updates, and service-related notifications about my booking. Message frequency varies. Message and data rates may apply. You can reply STOP to opt-out at any time.
                  </p>
                  <label className="flex items-start cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smsConsent}
                      onChange={(e) => setSmsConsent(e.target.checked)}
                      className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mt-0.5"
                      required
                    />
                    <span className="ml-3 text-sm text-slate-700">
                      I consent to receive SMS notifications about my booking and agree to the terms above. *
                    </span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleAcceptInvoice}
                disabled={
                  processing ||
                  !cardOnFileConsent ||
                  !smsConsent ||
                  (order.pickup_preference === 'next_day' && !overnightResponsibilityAccepted) ||
                  (paymentAmount === 'custom' && !customPaymentAmount)
                }
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (() => {
                  // Calculate total payment including tip
                  let paymentCents = 0;
                  const totalCents = order.deposit_due_cents + order.balance_due_cents;

                  if (paymentAmount === 'deposit') {
                    paymentCents = order.deposit_due_cents;
                  } else if (paymentAmount === 'full') {
                    paymentCents = totalCents;
                  } else if (paymentAmount === 'custom' && customPaymentAmount) {
                    paymentCents = Math.round(parseFloat(customPaymentAmount) * 100);
                  }

                  let tipCents = 0;
                  if (tipAmount === '10') {
                    tipCents = Math.round(totalCents * 0.1);
                  } else if (tipAmount === '15') {
                    tipCents = Math.round(totalCents * 0.15);
                  } else if (tipAmount === '20') {
                    tipCents = Math.round(totalCents * 0.2);
                  } else if (tipAmount === 'custom' && customTipAmount) {
                    tipCents = Math.round(parseFloat(customTipAmount) * 100);
                  }

                  const totalPayment = paymentCents + tipCents;

                  return totalPayment === 0 ? (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Accept Invoice
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-5 h-5 mr-2" />
                      Accept & Pay {formatCurrency(totalPayment)}
                    </>
                  );
                })()}
              </button>

              <p className="text-xs text-slate-500 text-center mt-4">
                {order.deposit_due_cents === 0
                  ? 'By accepting, you acknowledge the order details above'
                  : 'Your payment information is secured with industry-standard encryption'}
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Show regular status message for non-draft orders
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg overflow-hidden border-2 border-slate-300">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-center">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-20 w-auto mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-white">Order Status</h1>
            <p className="text-blue-100 mt-2">Order #{order.id.slice(0, 8).toUpperCase()}</p>
          </div>

          <div className="px-8 py-8 text-center">
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-blue-900 mb-3">
                {order.status === 'draft' && 'Invoice Pending'}
                {order.status === 'pending_review' && 'Order Under Review'}
                {order.status === 'cancelled' && 'Order Cancelled'}
                {order.status === 'void' && 'Order Voided'}
              </h2>
              <p className="text-slate-700 mb-4">
                {order.status === 'draft' && 'This invoice is awaiting your acceptance. Please check your email for the invoice link.'}
                {order.status === 'pending_review' && 'Thank you! Your booking is currently being reviewed by our team. If you already approved recent changes, we\'ve received your approval and will finalize your booking shortly. You\'ll receive an email with next steps once your order is confirmed.'}
                {order.status === 'cancelled' && 'This order has been cancelled. If you have questions, please contact us.'}
                {order.status === 'void' && 'This order is no longer valid. Please contact us if you need assistance.'}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-slate-200">
                <span className="text-slate-600 font-medium">Customer:</span>
                <span className="text-slate-900">{order.customers?.first_name || 'Pending'} {order.customers?.last_name || ''}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-slate-200">
                <span className="text-slate-600 font-medium">Event Date:</span>
                <span className="text-slate-900">{format(new Date(order.event_date), 'MMMM d, yyyy')}</span>
              </div>
              <div className="flex justify-between py-3 border-b border-slate-200">
                <span className="text-slate-600 font-medium">Total:</span>
                <span className="text-slate-900 font-semibold">{formatCurrency(order.deposit_due_cents + order.balance_due_cents)}</span>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200">
              <p className="text-slate-600 text-sm mb-4">Questions about your order?</p>
              <a
                href="tel:+13138893860"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Call (313) 889-3860
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Special view when order needs approval - ONLY show approval interface
  if (needsApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 py-4 md:py-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg md:rounded-xl shadow-2xl overflow-hidden border-2 md:border-4 border-amber-400">
            {/* Logo Header */}
            <div className="bg-white px-4 md:px-8 py-4 md:py-6 text-center border-b-2 md:border-b-4 border-amber-400">
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club"
                className="h-16 md:h-20 w-auto mx-auto mb-3 md:mb-4"
              />
              <h1 className="text-lg md:text-2xl font-bold text-amber-900">Order Changes - Approval Required</h1>
              <p className="text-sm md:text-base text-amber-700 mt-1 md:mt-2">Order #{order.id.slice(0, 8).toUpperCase()}</p>
            </div>

            <div className="px-4 md:px-8 py-4 md:py-8">
              <div className="bg-amber-100 border-2 border-amber-500 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
                <h2 className="text-base md:text-lg font-bold text-amber-900 mb-2 md:mb-3">Action Required</h2>
                <p className="text-sm md:text-base text-amber-800">
                  We've updated your booking details. Please review the changes below and confirm your approval.
                </p>
              </div>

              {/* Admin Message */}
              {order.admin_message && (
                <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
                  <h3 className="font-bold text-blue-900 mb-2 md:mb-3 text-base md:text-lg">Message from Bounce Party Club</h3>
                  <p className="text-sm md:text-base text-blue-800 whitespace-pre-wrap">{order.admin_message}</p>
                </div>
              )}

              {/* Payment Method Cleared Notice */}
              {!order.stripe_payment_method_id && changelog.some(c => c.field_changed === 'payment_method') && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
                  <h3 className="font-bold text-amber-900 mb-2 md:mb-3 text-base md:text-lg">Payment Update Required</h3>
                  <p className="text-sm md:text-base text-amber-800">
                    Due to changes in your order, your previous payment method has been removed for your security. You'll need to provide a new payment method when you approve these changes.
                  </p>
                </div>
              )}

              {/* What Changed Section */}
              {(() => {
                // Filter to only customer-relevant changes
                const customerRelevantFields = [
                  'event_date', 'event_end_date', 'address', 'location_type',
                  'surface', 'generator_qty', 'pickup_preference', 'total', 'order_items'
                ];

                const relevantChanges = changelog.filter(c =>
                  customerRelevantFields.includes(c.field_changed)
                );

                if (relevantChanges.length === 0) return null;

                const formatValue = (val: string, field: string) => {
                  if (!val || val === 'null' || val === '') return '';
                  if (field === 'total') {
                    return formatCurrency(parseInt(val));
                  }
                  if (field === 'event_date' || field === 'event_end_date') {
                    return format(new Date(val), 'MMMM d, yyyy');
                  }
                  if (field === 'location_type') {
                    return val === 'residential' ? 'Residential' : 'Commercial';
                  }
                  if (field === 'surface') {
                    return val === 'grass' ? 'Grass (Stakes)' : 'Concrete (Sandbags)';
                  }
                  if (field === 'pickup_preference') {
                    return val === 'next_day' ? 'Next Morning' : 'Same Day';
                  }
                  if (field === 'generator_qty') {
                    return val === '0' ? 'None' : `${val} Generator${val === '1' ? '' : 's'}`;
                  }
                  if (field === 'address') {
                    // Extract zip code from address if available
                    return val;
                  }
                  return val;
                };

                const getFieldLabel = (field: string) => {
                  const labels: Record<string, string> = {
                    'event_date': 'Event Date',
                    'event_end_date': 'Event End Date',
                    'address': 'Address',
                    'location_type': 'Location Type',
                    'surface': 'Surface',
                    'generator_qty': 'Generators',
                    'pickup_preference': 'Pickup',
                    'total': 'Total Price',
                    'order_items': 'Equipment'
                  };
                  return labels[field] || field;
                };

                return (
                  <div className="bg-orange-50 border-2 border-orange-400 rounded-lg p-3 md:p-5 mb-4 md:mb-6">
                    <h3 className="font-bold text-orange-900 mb-2 md:mb-3 text-sm md:text-base flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 md:w-5 md:h-5" />
                      What Changed
                    </h3>
                    <div className="bg-white rounded border border-orange-200 divide-y divide-orange-100">
                      {relevantChanges
                        .filter(change => {
                          // Hide event end date if it's the same as start date
                          if (change.field_changed === 'event_end_date') {
                            const eventDateChange = relevantChanges.find(c => c.field_changed === 'event_date');
                            if (eventDateChange && change.new_value === eventDateChange.new_value) {
                              return false;
                            }
                          }
                          return true;
                        })
                        .sort((a, b) => {
                          // Custom sort order: event_date before event_end_date
                          const order = ['total', 'event_date', 'event_end_date', 'address', 'pickup', 'location_type', 'surface', 'generator_qty', 'order_items'];
                          return order.indexOf(a.field_changed) - order.indexOf(b.field_changed);
                        })
                        .map((change, idx) => {
                        const isItemChange = change.field_changed === 'order_items';
                        const oldVal = formatValue(change.old_value, change.field_changed);
                        const newVal = formatValue(change.new_value, change.field_changed);

                        return (
                          <div key={idx} className="px-3 md:px-4 py-2.5 text-xs md:text-sm">
                            <div className="font-medium text-orange-900 mb-1">
                              {getFieldLabel(change.field_changed)}:
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {isItemChange ? (
                                // For item add/remove, show special format
                                <>
                                  {oldVal && <span className="text-red-700">Removed: {oldVal}</span>}
                                  {newVal && <span className="text-green-700 font-semibold">Added: {newVal}</span>}
                                </>
                              ) : (
                                // For regular changes, show old → new
                                <>
                                  <span className="text-red-700 line-through break-words">{oldVal}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-green-700 font-semibold break-words">{newVal}</span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Updated Order Details */}
              <div className="bg-slate-50 rounded-lg p-3 md:p-6 mb-4 md:mb-6 border-2 border-slate-200">
                <h3 className="font-bold text-slate-900 mb-3 md:mb-4 text-base md:text-lg">Current Booking Information</h3>
                <div className="space-y-2 md:space-y-3">
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Customer:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}</span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Event Date:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">
                      {format(new Date(order.event_date), 'MMMM d, yyyy')}
                      {order.event_end_date && order.event_end_date !== order.event_date && (
                        <> - {format(new Date(order.event_end_date), 'MMMM d, yyyy')}</>
                      )}
                    </span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Time:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.start_window} - {order.end_window}</span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Location Type:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.location_type === 'residential' ? 'Residential' : 'Commercial'}</span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Address:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}</span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Surface:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.surface === 'grass' ? 'Grass (Stakes)' : 'Sandbags'}</span>
                  </div>
                  <div className="py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Pickup:</span>
                    <span className="text-slate-900 font-semibold text-sm md:text-base">{order.pickup_preference === 'next_day' ? 'Next Morning' : 'Same Day'}</span>
                  </div>

                  {/* Centralized Price Breakdown with Changelog Highlighting */}
                  {orderSummary && (
                    <OrderSummary
                      summary={orderSummary}
                      showDeposit={true}
                      showTip={orderSummary.tip > 0}
                      title="Complete Price Breakdown"
                      changelog={changelog}
                      className="p-3 md:p-4"
                    />
                  )}
                </div>
              </div>

              {/* Identity Confirmation */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
                <h3 className="font-bold text-blue-900 mb-2">Identity Verification Required</h3>
                <p className="text-blue-800 text-sm">
                  To approve these changes, you'll be asked to confirm your identity by entering your full name exactly as it appears on the order: <strong>{order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}</strong>
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-4">
                <div className="flex gap-4">
                  <button
                    onClick={handleApproveChanges}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition-colors text-lg shadow-lg"
                  >
                    Approve Changes
                  </button>
                  <a
                    href="tel:+13138893860"
                    className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-bold py-4 px-6 rounded-lg transition-colors text-center text-lg shadow-lg"
                  >
                    Call to Discuss
                  </a>
                </div>
                <button
                  onClick={handleRejectChanges}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-colors shadow-lg"
                >
                  Reject Changes & Cancel Order
                </button>
              </div>

              <p className="text-center text-slate-500 text-sm mt-6">
                Questions? Call us at (313) 889-3860
              </p>
            </div>

            <ApprovalModal
              isOpen={showApproveModal}
              onClose={() => setShowApproveModal(false)}
              order={order}
              onSuccess={async () => {
                setApprovalSuccess(true);
                await loadOrder();
              }}
            />

            <RejectionModal
              isOpen={showRejectModal}
              onClose={() => setShowRejectModal(false)}
              order={order}
              onSuccess={async () => {
                await loadOrder();
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Regular portal view for waiver, payment, pictures
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-8 py-6 text-white">
            <h1 className="text-3xl font-bold">Customer Portal</h1>
            <p className="mt-2">Order #{order.id.slice(0, 8).toUpperCase()}</p>
            <p className="text-sm opacity-90">
              Event Date: {format(new Date(order.event_date), 'MMMM d, yyyy')} at {order.start_window}
            </p>
          </div>

          <div className="px-8 py-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Complete These Steps</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`border rounded-lg p-4 ${needsWaiver ? 'border-amber-500 bg-amber-50' : 'border-green-500 bg-green-50'}`}>
                  <div className="flex items-center gap-3">
                    {needsWaiver ? (
                      <FileText className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">Sign Waiver</p>
                      <p className="text-xs text-slate-600">{needsWaiver ? 'Required' : 'Complete'}</p>
                    </div>
                  </div>
                </div>

                <div className={`border rounded-lg p-4 ${needsPayment ? 'border-amber-500 bg-amber-50' : 'border-green-500 bg-green-50'}`}>
                  <div className="flex items-center gap-3">
                    {needsPayment ? (
                      <CreditCard className="w-6 h-6 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">Payment</p>
                      <p className="text-xs text-slate-600">
                        {needsPayment ? `${formatCurrency(balanceDue)} due` : 'Complete'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                    <div>
                      <p className="font-semibold text-slate-900">Pictures</p>
                      <p className="text-xs text-slate-600">Optional</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mb-6 border-b border-slate-200">
              <button
                onClick={() => setActiveTab('waiver')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  activeTab === 'waiver'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Waiver
              </button>
              <button
                onClick={() => setActiveTab('payment')}
                disabled={needsWaiver}
                className={`px-4 py-2 font-medium border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  activeTab === 'payment'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Payment
              </button>
              <button
                onClick={() => setActiveTab('pictures')}
                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                  activeTab === 'pictures'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Pictures
              </button>
            </div>

            {activeTab === 'waiver' && (
              <WaiverTab orderId={orderId!} order={order} />
            )}

            {activeTab === 'payment' && (
              <PaymentTab order={order} balanceDue={balanceDue} onPayment={handlePayment} />
            )}

            {activeTab === 'pictures' && (
              <PicturesTab onSubmit={handleSubmitPictures} />
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          <p>Questions? Call us or text us at the number provided in your confirmation.</p>
        </div>
      </div>

      {showInvoiceModal && prepareInvoiceData() && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto relative">
            <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex justify-between items-center z-10 no-print">
              <h2 className="text-2xl font-bold text-slate-900">Invoice Preview</h2>
              <div className="flex gap-2">
                <button
                  onClick={handlePrintInvoice}
                  className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print / Save PDF
                </button>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 mr-2" />
                  Close
                </button>
              </div>
            </div>
            <div className="p-4">
              <PrintableInvoice
                quoteData={prepareInvoiceData()!.quoteData}
                priceBreakdown={prepareInvoiceData()!.priceBreakdown}
                cart={prepareInvoiceData()!.cart}
                contactData={prepareInvoiceData()!.contactData}
                invoiceNumber={order?.id?.slice(0, 8).toUpperCase()}
                isPaid={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
