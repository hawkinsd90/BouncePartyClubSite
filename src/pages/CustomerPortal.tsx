import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { CheckCircle, Upload, CreditCard, FileText, Image as ImageIcon, AlertCircle, Sparkles, TrendingUp, Shield, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import WaiverTab from '../components/WaiverTab';

export function CustomerPortal() {
  const { orderId, token } = useParams();
  const location = useLocation();
  const isInvoiceLink = location.pathname.startsWith('/invoice/');
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'waiver' | 'payment' | 'pictures'>('waiver');
  const [signature, setSignature] = useState('');
  const [pictureNotes, setPictureNotes] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [approvalSuccess, setApprovalSuccess] = useState(false);
  const [changelog, setChangelog] = useState<any[]>([]);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectConfirmName, setRejectConfirmName] = useState('');
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveConfirmName, setApproveConfirmName] = useState('');
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

        if (new Date(linkData.expires_at) < new Date()) {
          setLoading(false);
          return;
        }

        setInvoiceLink(linkData);
        orderIdToLoad = linkData.order_id;
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
        if (data.customers) {
          setCustomerInfo({
            first_name: data.customers.first_name || '',
            last_name: data.customers.last_name || '',
            email: data.customers.email || '',
            phone: data.customers.phone || '',
            business_name: data.customers.business_name || '',
          });
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
            .eq('order_id', orderId)
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
      }
    } catch (error) {
      console.error('Error loading order:', error);
    } finally {
      setLoading(false);
    }
  }


  async function handlePayment() {
    alert('Payment processing will be implemented with Stripe integration');
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImages([...uploadedImages, reader.result as string]);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmitPictures() {
    if (uploadedImages.length === 0) {
      alert('Please upload at least one picture');
      return;
    }

    setSubmitting(true);
    try {
      alert('Picture submission feature coming soon - images will be stored in Supabase Storage');
      setSubmitting(false);
    } catch (error) {
      console.error('Error submitting pictures:', error);
      alert('Failed to submit pictures');
      setSubmitting(false);
    }
  }

  async function handleAcceptInvoice() {
    if (!cardOnFileConsent || !smsConsent) {
      alert('Please accept both authorization and consent terms');
      return;
    }

    // If customer info not filled, require it
    if (invoiceLink && !invoiceLink.customer_filled && (!customerInfo.first_name || !customerInfo.last_name || !customerInfo.email || !customerInfo.phone)) {
      alert('Please fill in all required customer information');
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

      // Get the deposit amount from invoice link or order
      const depositCents = invoiceLink?.deposit_cents ?? order.deposit_due_cents ?? 0;

      // If deposit is $0, just mark as accepted
      if (depositCents === 0) {
        await supabase
          .from('orders')
          .update({
            status: 'awaiting_customer_approval',
          })
          .eq('id', order.id);

        alert('Invoice accepted! You will receive a confirmation shortly.');
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
            depositCents: depositCents,
            tipCents: 0,
            customerEmail: customerInfo.email,
            customerName: `${customerInfo.first_name} ${customerInfo.last_name}`,
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
      alert('Failed to process invoice: ' + err.message);
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

  async function confirmApproveChanges() {
    if (!order.customers) {
      alert('Customer information is missing. Please contact support.');
      return;
    }
    const expectedName = `${order.customers.first_name} ${order.customers.last_name}`.toLowerCase().trim();
    if (approveConfirmName.toLowerCase().trim() !== expectedName) {
      alert('The name you entered does not match the customer name on this order. Please try again.');
      return;
    }

    setSubmitting(true);
    try {
      // Check availability before approving
      const checks = orderItems.map((item: any) => ({
        unitId: item.unit_id,
        wetOrDry: item.wet_or_dry,
        quantity: item.qty,
        eventStartDate: order.event_date,
        eventEndDate: order.event_end_date,
        excludeOrderId: order.id,
      }));

      const availabilityResults = await checkMultipleUnitsAvailability(checks);
      const conflicts = availabilityResults.filter(result => !result.isAvailable);

      if (conflicts.length > 0) {
        const conflictList = conflicts
          .map(c => {
            const item = orderItems.find((i: any) => i.unit_id === c.unitId);
            return item?.units?.name || 'Unknown unit';
          })
          .join(', ');

        alert(
          `We're sorry, but the following equipment is no longer available for your selected dates: ${conflictList}\n\n` +
          'Please call us at (313) 889-3860 to discuss alternative dates or equipment options.'
        );
        setSubmitting(false);
        return;
      }

      const { error } = await supabase
        .from('orders')
        .update({ status: 'pending_review' })
        .eq('id', orderId);

      if (error) throw error;

      // Send admin SMS notification
      try {
        const { data: adminSettings } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_notification_phone')
          .maybeSingle();

        if (adminSettings?.value) {
          const adminPhone = adminSettings.value as string;
          const adminSmsMessage =
            `Customer approved order changes! ` +
            `${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''} - ` +
            `Order #${order.id.slice(0, 8).toUpperCase()}. ` +
            `Review pending orders now.`;

          const smsApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
          await fetch(smsApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: adminPhone,
              message: adminSmsMessage,
              // Don't link admin notifications to order
            }),
          });
        }
      } catch (smsError) {
        console.error('Error sending admin SMS:', smsError);
        // Don't fail the approval if SMS fails
      }

      setShowApproveModal(false);
      setApproveConfirmName('');
      setApprovalSuccess(true);
    } catch (error) {
      console.error('Error approving changes:', error);
      alert('Failed to approve changes');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectChanges() {
    setShowRejectModal(true);
  }

  async function confirmRejectChanges() {
    if (!order.customers) {
      alert('Customer information is missing. Please contact support.');
      return;
    }
    const expectedName = `${order.customers.first_name} ${order.customers.last_name}`.toLowerCase().trim();
    if (rejectConfirmName.toLowerCase().trim() !== expectedName) {
      alert('The name you entered does not match the customer name on this order. Please try again.');
      return;
    }

    const rejectionReason = rejectReason.trim() || 'No reason provided';

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          admin_message: `Customer rejected changes. Reason: ${rejectionReason}`
        })
        .eq('id', orderId);

      if (error) throw error;

      // Send admin notifications
      try {
        // Get admin contact info
        const { data: adminPhone } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_notification_phone')
          .maybeSingle();

        const { data: adminEmail } = await supabase
          .from('admin_settings')
          .select('value')
          .eq('key', 'admin_notification_email')
          .maybeSingle();

        const customerName = order.customers ? `${order.customers.first_name} ${order.customers.last_name}` : 'Unknown Customer';
        const orderNum = order.id.slice(0, 8).toUpperCase();

        // Send SMS
        if (adminPhone?.value) {
          const adminSmsMessage =
            `⚠️ CUSTOMER REJECTED CHANGES! ` +
            `${customerName} rejected order changes for Order #${orderNum}. ` +
            `Reason: ${rejectionReason}. ` +
            `Order has been cancelled.`;

          const smsApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`;
          await fetch(smsApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: adminPhone.value,
              message: adminSmsMessage,
            }),
          });
        }

        // Send Email
        if (adminEmail?.value) {
          const logoUrl = 'https://qaagfafagdpgzcijnfbw.supabase.co/storage/v1/object/public/public-assets/bounce-party-club-logo.png';

          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>Customer Rejected Order Changes</title>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc;">
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 3px solid #ef4444;">
                <div style="text-align: center; border-bottom: 2px solid #ef4444; padding-bottom: 20px; margin-bottom: 25px;">
                  <img src="${logoUrl}" alt="Bounce Party Club" style="height: 70px; width: auto;" />
                  <h2 style="color: #ef4444; margin: 15px 0 0;">⚠️ Customer Rejected Changes</h2>
                </div>
                <p style="margin: 0 0 20px; color: #475569; font-size: 16px;">
                  <strong>${customerName}</strong> has rejected the proposed changes for their booking.
                </p>

                <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #991b1b; font-weight: bold;">Order Details:</p>
                  <p style="margin: 10px 0 0; color: #7f1d1d;">
                    <strong>Order #:</strong> ${orderNum}<br>
                    <strong>Customer:</strong> ${customerName}<br>
                    <strong>Email:</strong> ${order.customers?.email || 'N/A'}<br>
                    <strong>Phone:</strong> ${order.customers?.phone || 'N/A'}<br>
                    <strong>Event Date:</strong> ${format(new Date(order.event_date), 'MMMM d, yyyy')}
                  </p>
                </div>

                <div style="background-color: #f1f5f9; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #334155; font-weight: bold;">Rejection Reason:</p>
                  <p style="margin: 10px 0 0; color: #475569;">${rejectionReason}</p>
                </div>

                <div style="background-color: #fef3c7; border: 2px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #92400e; font-weight: bold;">⚠️ Action Required:</p>
                  <p style="margin: 10px 0 0; color: #92400e;">
                    The order has been automatically cancelled. Please contact the customer to discuss their concerns and potentially create a new booking that meets their needs.
                  </p>
                </div>

                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0; color: #64748b; font-size: 14px;">
                    Customer Contact: ${order.customers?.phone || 'N/A'} | ${order.customers?.email || 'N/A'}
                  </p>
                </div>
              </div>
            </body>
            </html>
          `;

          const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
          await fetch(emailApiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: adminEmail.value,
              subject: `⚠️ Customer Rejected Changes - Order #${orderNum}`,
              html: emailHtml,
            }),
          });
        }
      } catch (notificationError) {
        console.error('Error sending notifications:', notificationError);
        // Don't fail the rejection if notifications fail
      }

      setShowRejectModal(false);
      setRejectConfirmName('');
      setRejectReason('');
      alert('Your order has been cancelled. We\'re sorry we couldn\'t meet your needs. Our team will be in touch shortly.');
      await loadOrder();
    } catch (error) {
      console.error('Error rejecting changes:', error);
      alert('Failed to process rejection. Please call us at (313) 889-3860.');
    } finally {
      setSubmitting(false);
    }
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
    // Show invoice acceptance for draft orders
    if (order.status === 'draft' && isInvoiceLink) {
      const depositCents = invoiceLink?.deposit_cents ?? order.deposit_due_cents ?? 0;
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

              <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Invoice Summary</h2>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(order.subtotal_cents)}</span>
                  </div>
                  {discounts.map((discount, idx) => (
                    <div key={idx} className="flex justify-between text-sm text-red-700">
                      <span>{discount.name}:</span>
                      <span className="font-semibold">-{formatCurrency(discount.amount_cents)}</span>
                    </div>
                  ))}
                  {customFees.map((fee, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-slate-600">{fee.name}:</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(fee.amount_cents)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Tax (6%):</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(order.tax_cents)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-blue-300">
                    <span className="font-bold text-slate-900">Total:</span>
                    <span className="text-xl font-bold text-slate-900">{formatCurrency(order.total_cents)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-blue-300">
                    <span className="text-slate-600">
                      {depositCents === 0 ? 'Payment Required:' : 'Deposit Due Today:'}
                    </span>
                    <span className="text-lg font-bold text-blue-600">
                      {formatCurrency(depositCents)}
                    </span>
                  </div>
                  {depositCents > 0 && depositCents < order.total_cents && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Balance Due at Event:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(order.total_cents - depositCents)}
                      </span>
                    </div>
                  )}
                </div>
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

              <div className="mb-8 space-y-4">
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
                disabled={processing || !cardOnFileConsent || !smsConsent}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors flex items-center justify-center"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : depositCents === 0 ? (
                  <>
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Accept Invoice
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Accept & Pay {formatCurrency(depositCents)}
                  </>
                )}
              </button>

              <p className="text-xs text-slate-500 text-center mt-4">
                {depositCents === 0
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

                  {/* Order Items */}
                  {orderItems.length > 0 && (
                    <div className="pt-3 md:pt-4 border-t border-slate-300">
                      <p className="text-slate-600 font-medium mb-2 text-sm md:text-base">Equipment:</p>
                      <ul className="space-y-1 ml-2 md:ml-4">
                        {orderItems.map((item, idx) => (
                          <li key={idx} className="text-slate-900 text-xs md:text-sm break-words">
                            • {item.units.name} ({item.wet_or_dry === 'dry' ? 'Dry' : 'Water'}) - {formatCurrency(item.unit_price_cents)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Generators */}
                  {order.generator_fee_cents > 0 && (
                    <div className="py-2 border-t border-slate-300">
                      <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">Generators:</span>
                      <span className="text-slate-900 font-semibold text-sm md:text-base">{formatCurrency(order.generator_fee_cents)}</span>
                    </div>
                  )}

                  {/* Discounts */}
                  {discounts.length > 0 && (
                    <div className="pt-2 border-t border-slate-300">
                      <p className="text-slate-600 font-medium mb-2 text-sm md:text-base">Discounts:</p>
                      <ul className="space-y-1 ml-2 md:ml-4">
                        {discounts.map((discount, idx) => (
                          <li key={idx} className="text-green-700 text-xs md:text-sm break-words">
                            • {discount.name}: -{formatCurrency(discount.amount_cents)}
                            {discount.percentage > 0 && ` (${discount.percentage}%)`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Custom Fees */}
                  {customFees.length > 0 && (
                    <div className="pt-2 border-t border-slate-300">
                      <p className="text-slate-600 font-medium mb-2 text-sm md:text-base">Additional Fees:</p>
                      <ul className="space-y-1 ml-2 md:ml-4">
                        {customFees.map((fee, idx) => (
                          <li key={idx} className="text-slate-900 text-xs md:text-sm break-words">
                            • {fee.name}: {formatCurrency(fee.amount_cents)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Detailed Pricing Breakdown */}
                  <div className="pt-3 md:pt-4 border-t-2 border-slate-400">
                    <h4 className="font-bold text-slate-900 mb-2 md:mb-3 text-sm md:text-base">Complete Price Breakdown</h4>
                    {(() => {
                      // Helper function to check if a field changed
                      const hasChanged = (fieldName: string) => {
                        return changelog.some(c => c.field_changed === fieldName);
                      };

                      // Helper function to get old value from changelog
                      const getOldValue = (fieldName: string) => {
                        const change = changelog.find(c => c.field_changed === fieldName);
                        return change ? change.old_value : null;
                      };

                      // Check for item additions
                      const addedItems = changelog.filter(c => c.field_changed === 'order_items' && c.new_value && !c.old_value);

                      console.log('Rendering price breakdown:');
                      console.log('- Discounts:', discounts);
                      console.log('- Custom Fees:', customFees);
                      console.log('- Order Items:', orderItems);

                      return (
                        <div className="space-y-2 bg-white p-3 md:p-4 rounded border border-slate-200">
                          {/* ITEMS Section */}
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">ITEMS</div>

                          {/* Equipment Items */}
                          {orderItems.map((item, idx) => {
                            const isNew = addedItems.some(change =>
                              change.new_value.includes(item.units.name)
                            );

                            return (
                              <div key={idx} className="flex flex-col sm:flex-row sm:justify-between text-xs md:text-sm items-start sm:items-center gap-1">
                                <span className="text-slate-700 flex flex-wrap items-center gap-1 md:gap-2">
                                  <span className="break-words">{item.units.name} ({item.wet_or_dry === 'dry' ? 'Dry' : 'Water'})</span>
                                  {item.qty > 1 && <span className="whitespace-nowrap">× {item.qty}</span>}
                                  {isNew && (
                                    <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">NEW</span>
                                  )}
                                </span>
                                <span className="text-slate-900 font-medium whitespace-nowrap">{formatCurrency(item.unit_price_cents * item.qty)}</span>
                              </div>
                            );
                          })}

                          {/* Items Subtotal */}
                          <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                            <span className="text-slate-700 font-medium">Items Subtotal:</span>
                            <div className="flex items-center gap-2">
                              {hasChanged('subtotal') && getOldValue('subtotal') && (
                                <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('subtotal')))}</span>
                              )}
                              <span className={`font-semibold ${hasChanged('subtotal') ? 'text-blue-700' : 'text-slate-900'}`}>{formatCurrency(order.subtotal_cents)}</span>
                            </div>
                          </div>

                          {/* FEES Section */}
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 mt-4">FEES</div>

                          {/* Generator Fee (detailed breakdown) */}
                          {order.generator_fee_cents > 0 && (
                            <div className={`flex justify-between text-sm ${hasChanged('generator_fee') || hasChanged('generator_qty') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
                              <span className="text-slate-700 flex items-center gap-2">
                                Generators
                                {(hasChanged('generator_fee') || hasChanged('generator_qty')) && (
                                  <TrendingUp className="w-4 h-4 text-blue-600" />
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                {(hasChanged('generator_fee') || hasChanged('generator_qty')) && getOldValue('generator_fee') && (
                                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('generator_fee')))}</span>
                                )}
                                <span className={`font-medium ${hasChanged('generator_fee') || hasChanged('generator_qty') ? 'text-blue-700' : 'text-slate-900'}`}>{formatCurrency(order.generator_fee_cents)}</span>
                              </div>
                            </div>
                          )}

                          {/* Travel Fee */}
                          <div className={`flex justify-between text-sm ${hasChanged('travel_fee') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
                            <span className="text-slate-700 flex items-center gap-2">
                              Travel Fee
                              {order.travel_chargeable_miles > 0 &&
                                ` (${order.travel_chargeable_miles.toFixed(1)} mi)`
                              }
                              {hasChanged('travel_fee') && (
                                <TrendingUp className="w-4 h-4 text-blue-600" />
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              {hasChanged('travel_fee') && getOldValue('travel_fee') && (
                                <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('travel_fee')))}</span>
                              )}
                              <span className={`font-medium ${hasChanged('travel_fee') ? 'text-blue-700' : 'text-slate-900'}`}>
                                {order.travel_fee_cents > 0 ? formatCurrency(order.travel_fee_cents) : '$0.00'}
                              </span>
                            </div>
                          </div>

                          {/* Surface Fee */}
                          {order.surface_fee_cents > 0 && (
                            <div className={`flex justify-between text-sm ${hasChanged('surface_fee') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
                              <span className="text-slate-700 flex items-center gap-2">
                                Surface Fee (Sandbags)
                                {hasChanged('surface_fee') && (
                                  <TrendingUp className="w-4 h-4 text-blue-600" />
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                {hasChanged('surface_fee') && getOldValue('surface_fee') && (
                                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('surface_fee')))}</span>
                                )}
                                <span className={`font-medium ${hasChanged('surface_fee') ? 'text-blue-700' : 'text-slate-900'}`}>{formatCurrency(order.surface_fee_cents)}</span>
                              </div>
                            </div>
                          )}

                          {/* Same Day Pickup Fee */}
                          {order.same_day_pickup_fee_cents > 0 && (
                            <div className={`flex justify-between text-sm ${hasChanged('same_day_pickup_fee') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
                              <span className="text-slate-700 flex items-center gap-2">
                                Same-Day Pickup Fee
                                {hasChanged('same_day_pickup_fee') && (
                                  <TrendingUp className="w-4 h-4 text-blue-600" />
                                )}
                              </span>
                              <span className="text-slate-900 font-medium">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                            </div>
                          )}

                          {/* Custom Fees */}
                          {customFees.map((fee, idx) => (
                            <div key={`fee-${idx}`} className="flex justify-between text-sm items-center">
                              <span className="text-slate-700 flex items-center gap-2">
                                {fee.name}
                                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">ADDED</span>
                              </span>
                              <span className="text-slate-900 font-medium">{formatCurrency(fee.amount_cents)}</span>
                            </div>
                          ))}

                          {/* Discounts */}
                          {discounts.length > 0 && (
                            <>
                              <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 mt-4">DISCOUNT</div>
                              {discounts.map((discount, idx) => (
                                <div key={`discount-${idx}`} className="flex justify-between text-sm">
                                  <span className="text-green-700 font-medium">
                                    {discount.name} {discount.percentage > 0 && `(${discount.percentage}%)`}
                                  </span>
                                  <span className="text-green-700 font-semibold">-{formatCurrency(discount.amount_cents)}</span>
                                </div>
                              ))}
                            </>
                          )}

                          {/* Tax */}
                          <div className="flex justify-between text-sm pt-2 border-t border-slate-200">
                            <span className="text-slate-700">Tax (6%):</span>
                            <div className="flex items-center gap-2">
                              {hasChanged('tax') && getOldValue('tax') && (
                                <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('tax')))}</span>
                              )}
                              <span className={`font-medium ${hasChanged('tax') ? 'text-blue-700' : 'text-slate-900'}`}>{formatCurrency(order.tax_cents)}</span>
                            </div>
                          </div>

                          {/* Tip */}
                          {order.tip_cents > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-700">Tip (Optional):</span>
                              <span className="text-slate-900 font-medium">{formatCurrency(order.tip_cents)}</span>
                            </div>
                          )}

                          {/* Total */}
                          <div className="flex justify-between pt-3 border-t-2 border-slate-400">
                            <span className="text-slate-900 font-bold text-base">Total:</span>
                            <div className="flex items-center gap-2">
                              {hasChanged('total') && getOldValue('total') && (
                                <span className="text-sm text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('total')))}</span>
                              )}
                              <span className={`font-bold text-xl ${hasChanged('total') ? 'text-blue-700' : 'text-slate-900'}`}>{formatCurrency(order.deposit_due_cents + order.balance_due_cents)}</span>
                            </div>
                          </div>

                          {/* Payment Split */}
                          <div className="mt-4 pt-3 border-t border-slate-300 space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-green-700 font-semibold">Deposit Due Now:</span>
                              <div className="flex items-center gap-2">
                                {hasChanged('deposit_due') && getOldValue('deposit_due') && (
                                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('deposit_due')))}</span>
                                )}
                                <span className="text-green-700 font-bold text-base">{formatCurrency(order.deposit_due_cents)}</span>
                              </div>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">Balance Due After Event:</span>
                              <div className="flex items-center gap-2">
                                {hasChanged('balance_due') && getOldValue('balance_due') && (
                                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('balance_due')))}</span>
                                )}
                                <span className="text-slate-700 font-semibold">{formatCurrency(order.balance_due_cents)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
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
                    disabled={submitting}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-bold py-4 px-6 rounded-lg transition-colors text-lg shadow-lg"
                  >
                    {submitting ? 'Processing...' : 'Approve Changes'}
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
                  disabled={submitting}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-bold py-3 px-6 rounded-lg transition-colors shadow-lg"
                >
                  Reject Changes & Cancel Order
                </button>
              </div>

              <p className="text-center text-slate-500 text-sm mt-6">
                Questions? Call us at (313) 889-3860
              </p>
            </div>

            {/* Custom Approval Modal */}
            {showApproveModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                  <div className="p-4 md:p-6">
                    <h3 className="text-lg md:text-xl font-bold text-green-900 mb-3">Approve Order Changes</h3>
                    <p className="text-sm md:text-base text-slate-700 mb-4">
                      By approving these changes, you confirm that you have reviewed and accept the updated order details.
                    </p>

                    <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        To confirm, enter your full name: <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={approveConfirmName}
                        onChange={(e) => setApproveConfirmName(e.target.value)}
                        placeholder={`${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''}`}
                        className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-green-500 text-sm md:text-base"
                      />
                      <p className="text-xs text-slate-500 mt-1">Must match: {order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => {
                          setShowApproveModal(false);
                          setApproveConfirmName('');
                        }}
                        className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmApproveChanges}
                        disabled={!approveConfirmName.trim() || submitting}
                        className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-bold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
                      >
                        {submitting ? 'Processing...' : 'Confirm Approval'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Custom Rejection Modal */}
            {showRejectModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                  <div className="p-4 md:p-6">
                    <h3 className="text-lg md:text-xl font-bold text-red-900 mb-3">Reject Changes & Cancel Order</h3>
                    <p className="text-sm md:text-base text-slate-700 mb-4">
                      Are you sure you want to reject these changes? This will cancel your order.
                    </p>
                    <p className="text-sm text-slate-600 mb-4">
                      If you have questions, please call us at <a href="tel:+13138893860" className="text-blue-600 font-semibold">(313) 889-3860</a> instead.
                    </p>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        To confirm, enter your full name: <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={rejectConfirmName}
                        onChange={(e) => setRejectConfirmName(e.target.value)}
                        placeholder={`${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''}`}
                        className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-red-500 text-sm md:text-base"
                      />
                      <p className="text-xs text-slate-500 mt-1">Must match: {order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}</p>
                    </div>

                    <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Reason for rejection (optional):
                      </label>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Let us know why you're rejecting these changes..."
                        rows={3}
                        className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-red-500 resize-none text-sm md:text-base"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => {
                          setShowRejectModal(false);
                          setRejectConfirmName('');
                          setRejectReason('');
                        }}
                        className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmRejectChanges}
                        disabled={!rejectConfirmName.trim() || submitting}
                        className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white font-bold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
                      >
                        {submitting ? 'Processing...' : 'Confirm Rejection'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
              <div className="space-y-6">
                {balanceDue <= 0 ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                    <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-green-900">Payment Complete</h3>
                    <p className="text-sm text-green-700 mt-2">
                      No balance due. Thank you for your payment!
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Summary</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Total Order:</span>
                          <span className="font-semibold text-slate-900">
                            {formatCurrency(order.subtotal_cents + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Already Paid:</span>
                          <span className="font-semibold text-green-700">
                            {formatCurrency((order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0))}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-slate-300">
                          <span className="font-semibold text-slate-900">Balance Due:</span>
                          <span className="text-xl font-bold text-blue-600">
                            {formatCurrency(balanceDue)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handlePayment}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      <CreditCard className="w-5 h-5" />
                      Pay Balance Now
                    </button>

                    <p className="text-xs text-slate-500 text-center">
                      Secure payment powered by Stripe. We accept all major credit cards.
                    </p>
                  </>
                )}
              </div>
            )}

            {activeTab === 'pictures' && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>Optional:</strong> Upload pictures of the setup area or any concerns you have about the equipment condition.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Upload Pictures
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                {uploadedImages.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {uploadedImages.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-300">
                        <img src={img} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={pictureNotes}
                    onChange={(e) => setPictureNotes(e.target.value)}
                    placeholder="Any concerns or notes about the setup area..."
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg resize-none"
                    rows={4}
                  />
                </div>

                <button
                  onClick={handleSubmitPictures}
                  disabled={submitting || uploadedImages.length === 0}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Upload className="w-5 h-5" />
                  {submitting ? 'Submitting...' : 'Submit Pictures'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          <p>Questions? Call us or text us at the number provided in your confirmation.</p>
        </div>
      </div>
    </div>
  );
}
