import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { CheckCircle, Upload, CreditCard, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

export function CustomerPortal() {
  const { orderId } = useParams();
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

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  async function loadOrder() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (first_name, last_name, email, phone),
          addresses (line1, line2, city, state, zip)
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;
      if (data) {
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
          .eq('order_id', orderId);

        const { data: discountsData } = await supabase
          .from('order_discounts')
          .select('*')
          .eq('order_id', orderId);

        const { data: feesData } = await supabase
          .from('order_custom_fees')
          .select('*')
          .eq('order_id', orderId);

        if (itemsData) setOrderItems(itemsData);
        if (discountsData) setDiscounts(discountsData);
        if (feesData) setCustomFees(feesData);
      }
    } catch (error) {
      console.error('Error loading order:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignWaiver() {
    if (!signature.trim()) {
      alert('Please enter your full name to sign the waiver');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          waiver_signed_at: new Date().toISOString(),
          waiver_signature_data: signature,
        })
        .eq('id', orderId);

      if (error) throw error;

      alert('Waiver signed successfully!');
      await loadOrder();
      setActiveTab('payment');
    } catch (error) {
      console.error('Error signing waiver:', error);
      alert('Failed to sign waiver');
    } finally {
      setSubmitting(false);
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
  const needsApproval = order.status === 'awaiting_customer_approval' || (order.status === 'pending_review' && changelog.length > 0);
  const isActive = ['confirmed', 'in_progress', 'completed'].includes(order.status);

  async function handleApproveChanges() {
    const customerName = prompt('To confirm, please enter your full name as it appears on the order:');

    if (!customerName) {
      return;
    }

    const expectedName = `${order.customers.first_name} ${order.customers.last_name}`.toLowerCase().trim();
    if (customerName.toLowerCase().trim() !== expectedName) {
      alert('The name you entered does not match the customer name on this order. Please try again.');
      return;
    }

    setSubmitting(true);
    try {
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
            `${order.customers.first_name} ${order.customers.last_name} - ` +
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

      setApprovalSuccess(true);
    } catch (error) {
      console.error('Error approving changes:', error);
      alert('Failed to approve changes');
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

  // If order is not active and not awaiting approval, show status message
  if (!isActive && !needsApproval) {
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
                {order.status === 'draft' && 'Payment Required'}
                {order.status === 'pending_review' && 'Order Under Review'}
                {order.status === 'cancelled' && 'Order Cancelled'}
                {order.status === 'void' && 'Order Voided'}
              </h2>
              <p className="text-slate-700 mb-4">
                {order.status === 'draft' && 'This order requires payment before you can access the customer portal. Please complete the payment process to continue.'}
                {order.status === 'pending_review' && 'Thank you! Your booking is currently being reviewed by our team. If you already approved recent changes, we\'ve received your approval and will finalize your booking shortly. You\'ll receive an email with next steps once your order is confirmed.'}
                {order.status === 'cancelled' && 'This order has been cancelled. If you have questions, please contact us.'}
                {order.status === 'void' && 'This order is no longer valid. Please contact us if you need assistance.'}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-slate-200">
                <span className="text-slate-600 font-medium">Customer:</span>
                <span className="text-slate-900">{order.customers.first_name} {order.customers.last_name}</span>
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
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden border-4 border-amber-400">
            {/* Logo Header */}
            <div className="bg-white px-8 py-6 text-center border-b-4 border-amber-400">
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club"
                className="h-20 w-auto mx-auto mb-4"
              />
              <h1 className="text-2xl font-bold text-amber-900">Order Changes - Approval Required</h1>
              <p className="text-amber-700 mt-2">Order #{order.id.slice(0, 8).toUpperCase()}</p>
            </div>

            <div className="px-8 py-8">
              <div className="bg-amber-100 border-2 border-amber-500 rounded-lg p-6 mb-6">
                <h2 className="text-lg font-bold text-amber-900 mb-3">Action Required</h2>
                <p className="text-amber-800 mb-4">
                  We've updated your booking details. Please review the changes below and confirm your approval.
                </p>
              </div>

              {/* Admin Message */}
              {order.admin_message && (
                <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-6 mb-6">
                  <h3 className="font-bold text-blue-900 mb-3 text-lg">Message from Bounce Party Club</h3>
                  <p className="text-blue-800 whitespace-pre-wrap">{order.admin_message}</p>
                </div>
              )}

              {/* Changelog - What Changed */}
              {changelog.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-6 mb-6 border-2 border-blue-300">
                  <h3 className="font-bold text-blue-900 mb-4 text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    What Changed
                  </h3>
                  <div className="space-y-2">
                    {changelog.map((change, idx) => {
                      // Create friendly field labels
                      const fieldLabelMap: Record<string, string> = {
                        'location_type': 'Location Type',
                        'surface': 'Setup Surface',
                        'generator_qty': 'Generator Quantity',
                        'start_window': 'Start Time',
                        'end_window': 'End Time',
                        'event_date': 'Event Start Date',
                        'event_end_date': 'Event End Date',
                        'pickup_preference': 'Pickup Preference',
                        'address': 'Event Address',
                        'order_items': 'Order Items',
                        'discounts': 'Discounts',
                        'custom_fees': 'Custom Fees',
                        'admin_message': 'Message from Bounce Party Club',
                        'subtotal': 'Subtotal',
                        'generator_fee': 'Generator Fee',
                        'travel_fee': 'Travel Fee',
                        'surface_fee': 'Surface Fee',
                        'same_day_pickup_fee': 'Same-Day Pickup Fee',
                        'tax': 'Tax',
                        'deposit_due': 'Deposit Due',
                        'balance_due': 'Balance Due',
                        'total': 'Order Total',
                        'payment_method': 'Payment Method',
                        'status': 'Order Status',
                      };

                      const fieldLabel = fieldLabelMap[change.field_changed] ||
                        change.field_changed
                          .replace(/_/g, ' ')
                          .split(' ')
                          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ');

                      const formatValue = (value: any) => {
                        if (value === null || value === undefined || value === '') return 'None';

                        // Format time fields
                        if (change.field_changed === 'start_window' || change.field_changed === 'end_window') {
                          return value;
                        }

                        // Format date fields
                        if (change.field_changed === 'event_date' || change.field_changed === 'event_end_date') {
                          return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }

                        // Format pickup preference
                        if (change.field_changed === 'pickup_preference') {
                          return value === 'next_day' ? 'Next Morning' : 'Same Day';
                        }

                        // Format location type
                        if (change.field_changed === 'location_type') {
                          return value.charAt(0).toUpperCase() + value.slice(1);
                        }

                        // Format surface
                        if (change.field_changed === 'surface') {
                          return value === 'grass' ? 'Grass (Stakes)' : 'Sandbags';
                        }

                        // Format money fields
                        if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))) {
                          const numValue = typeof value === 'number' ? value : parseFloat(value);
                          if (fieldLabel.toLowerCase().includes('fee') || fieldLabel.toLowerCase().includes('deposit') ||
                              fieldLabel.toLowerCase().includes('balance') || fieldLabel.toLowerCase().includes('subtotal') ||
                              fieldLabel.toLowerCase().includes('tax') || fieldLabel.toLowerCase().includes('total')) {
                            return formatCurrency(numValue);
                          }
                        }
                        return String(value);
                      };

                      let changeDescription = '';
                      if (change.change_type === 'add') {
                        changeDescription = `Added: ${change.new_value}`;
                      } else if (change.change_type === 'remove') {
                        changeDescription = `Removed: ${change.old_value}`;
                      } else {
                        changeDescription = `${formatValue(change.old_value)} → ${formatValue(change.new_value)}`;
                      }

                      return (
                        <div key={idx} className="bg-white rounded p-3 border border-blue-200">
                          <div className="flex items-start justify-between">
                            <span className="text-sm font-semibold text-blue-900">{fieldLabel}:</span>
                            <span className="text-sm text-slate-700 text-right ml-4">{changeDescription}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Updated Order Details */}
              <div className="bg-slate-50 rounded-lg p-6 mb-6 border-2 border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4 text-lg">Current Booking Information</h3>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Customer:</span>
                    <span className="text-slate-900 font-semibold">{order.customers.first_name} {order.customers.last_name}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Event Date:</span>
                    <span className="text-slate-900 font-semibold">
                      {format(new Date(order.event_date), 'MMMM d, yyyy')}
                      {order.event_end_date && order.event_end_date !== order.event_date && (
                        <> - {format(new Date(order.event_end_date), 'MMMM d, yyyy')}</>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Time:</span>
                    <span className="text-slate-900 font-semibold">{order.start_window} - {order.end_window}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Location Type:</span>
                    <span className="text-slate-900 font-semibold">{order.location_type === 'residential' ? 'Residential' : 'Commercial'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Address:</span>
                    <span className="text-slate-900 font-semibold">{order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Surface:</span>
                    <span className="text-slate-900 font-semibold">{order.surface === 'grass' ? 'Grass (Stakes)' : 'Sandbags'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">Pickup:</span>
                    <span className="text-slate-900 font-semibold">{order.pickup_preference === 'next_day' ? 'Next Morning' : 'Same Day'}</span>
                  </div>

                  {/* Order Items */}
                  {orderItems.length > 0 && (
                    <div className="pt-4 border-t border-slate-300">
                      <p className="text-slate-600 font-medium mb-2">Equipment:</p>
                      <ul className="space-y-1 ml-4">
                        {orderItems.map((item, idx) => (
                          <li key={idx} className="text-slate-900 text-sm">
                            • {item.units.name} ({item.wet_or_dry === 'dry' ? 'Dry' : 'Water'}) - {formatCurrency(item.unit_price_cents)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Generators */}
                  {order.generator_fee_cents > 0 && (
                    <div className="flex justify-between py-2 border-t border-slate-300">
                      <span className="text-slate-600 font-medium">Generators:</span>
                      <span className="text-slate-900 font-semibold">{formatCurrency(order.generator_fee_cents)}</span>
                    </div>
                  )}

                  {/* Discounts */}
                  {discounts.length > 0 && (
                    <div className="pt-2 border-t border-slate-300">
                      <p className="text-slate-600 font-medium mb-2">Discounts:</p>
                      <ul className="space-y-1 ml-4">
                        {discounts.map((discount, idx) => (
                          <li key={idx} className="text-green-700 text-sm">
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
                      <p className="text-slate-600 font-medium mb-2">Additional Fees:</p>
                      <ul className="space-y-1 ml-4">
                        {customFees.map((fee, idx) => (
                          <li key={idx} className="text-slate-900 text-sm">
                            • {fee.name}: {formatCurrency(fee.amount_cents)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Pricing Summary */}
                  <div className="pt-4 border-t border-slate-300 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Items Subtotal:</span>
                      <span className="text-slate-900">{formatCurrency(order.subtotal_cents)}</span>
                    </div>
                    {order.travel_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Travel Fee:</span>
                        <span className="text-slate-900">{formatCurrency(order.travel_fee_cents)}</span>
                      </div>
                    )}
                    {order.surface_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Surface Fee (Sandbags):</span>
                        <span className="text-slate-900">{formatCurrency(order.surface_fee_cents)}</span>
                      </div>
                    )}
                    {order.same_day_pickup_fee_cents > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Same-Day Pickup Fee:</span>
                        <span className="text-slate-900">{formatCurrency(order.same_day_pickup_fee_cents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Tax (6%):</span>
                      <span className="text-slate-900">{formatCurrency(order.tax_cents)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-400">
                      <span className="text-slate-900 font-semibold">Total Amount:</span>
                      <span className="text-green-600 font-bold text-lg">{formatCurrency(order.deposit_due_cents + order.balance_due_cents)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Identity Confirmation */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
                <h3 className="font-bold text-blue-900 mb-2">Identity Verification Required</h3>
                <p className="text-blue-800 text-sm">
                  To approve these changes, you'll be asked to confirm your identity by entering your full name exactly as it appears on the order: <strong>{order.customers.first_name} {order.customers.last_name}</strong>
                </p>
              </div>

              {/* Action Buttons */}
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

              <p className="text-center text-slate-500 text-sm mt-6">
                Questions? Call us at (313) 889-3860
              </p>
            </div>
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
              <div className="space-y-6">
                {order.waiver_signed_at ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                    <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-green-900">Waiver Signed</h3>
                    <p className="text-sm text-green-700 mt-2">
                      Signed by {order.waiver_signature_data} on{' '}
                      {format(new Date(order.waiver_signed_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-slate-900 mb-4">Rental Agreement & Waiver</h3>
                      <div className="prose prose-sm max-w-none text-slate-700 space-y-3 max-h-96 overflow-y-auto">
                        <p className="font-semibold">PLEASE READ CAREFULLY BEFORE SIGNING</p>

                        <p><strong>1. RENTAL TERMS</strong></p>
                        <p>The customer agrees to rent the inflatable equipment for the date and time specified in the rental agreement. Setup and pickup times are approximate and may vary by up to 30 minutes.</p>

                        <p><strong>2. SAFETY REQUIREMENTS</strong></p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>Adult supervision is required at all times when equipment is in use</li>
                          <li>Do not use equipment in wet conditions or high winds (over 15 mph)</li>
                          <li>Remove shoes, glasses, jewelry, and sharp objects before use</li>
                          <li>Follow capacity limits at all times</li>
                          <li>No food, drinks, or silly string allowed on equipment</li>
                        </ul>

                        <p><strong>3. LIABILITY WAIVER</strong></p>
                        <p>The customer agrees to assume all risks associated with the use of the rental equipment and releases Bounce Party Club from any liability for injuries or damages that may occur. The customer agrees to supervise all users and ensure safety rules are followed.</p>

                        <p><strong>4. DAMAGE AND LOSS</strong></p>
                        <p>The customer is responsible for any damage to the equipment beyond normal wear and tear. This includes but is not limited to: punctures, tears, stains, and missing components. Replacement costs will be charged to the payment method on file.</p>

                        <p><strong>5. CANCELLATION POLICY</strong></p>
                        <p>Cancellations made more than 48 hours before the event date will receive a full refund. Cancellations within 48 hours are subject to a 50% cancellation fee. Weather-related cancellations will be rescheduled or refunded at no charge.</p>
                      </div>
                    </div>

                    <div className="border border-slate-300 rounded-lg p-4">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Electronic Signature
                      </label>
                      <p className="text-xs text-slate-600 mb-3">
                        By typing your full name below, you agree to all terms and conditions stated above.
                      </p>
                      <input
                        type="text"
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                        placeholder="Type your full name"
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <button
                      onClick={handleSignWaiver}
                      disabled={submitting || !signature.trim()}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                    >
                      {submitting ? 'Signing...' : 'Sign Waiver'}
                    </button>
                  </>
                )}
              </div>
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
