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
  const needsApproval = order.status === 'awaiting_customer_approval';

  async function handleApproveChanges() {
    if (!confirm('Do you approve these order changes? The order will be sent back to our team for final confirmation.')) {
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'pending_review' })
        .eq('id', orderId);

      if (error) throw error;

      alert('Thank you! Your approval has been received. Our team will finalize your booking shortly.');
      await loadOrder();
    } catch (error) {
      console.error('Error approving changes:', error);
      alert('Failed to approve changes');
    } finally {
      setSubmitting(false);
    }
  }

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
            {needsApproval && (
              <div className="mt-3 bg-amber-500 text-white px-4 py-2 rounded-lg">
                <p className="font-semibold">⚠️ Action Required: Please review and approve order changes</p>
              </div>
            )}
          </div>

          <div className="px-8 py-6">
            {needsApproval && (
              <div className="mb-8 bg-amber-50 border-2 border-amber-400 rounded-xl p-6">
                <h2 className="text-xl font-bold text-amber-900 mb-4">📝 Order Changes Need Your Approval</h2>
                <p className="text-amber-800 mb-4">
                  We've made updates to your booking. Please review the details below and approve the changes to proceed.
                </p>
                <div className="bg-white rounded-lg p-4 mb-4">
                  <h3 className="font-semibold text-slate-900 mb-3">Updated Order Details:</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-600">Event Date:</p>
                      <p className="font-medium">{format(new Date(order.event_date), 'MMMM d, yyyy')}</p>
                    </div>
                    <div>
                      <p className="text-slate-600">Time Window:</p>
                      <p className="font-medium">{order.start_window} - {order.end_window}</p>
                    </div>
                    <div>
                      <p className="text-slate-600">Location:</p>
                      <p className="font-medium">{order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state}</p>
                    </div>
                    <div>
                      <p className="text-slate-600">Total Amount:</p>
                      <p className="font-medium">{formatCurrency(order.deposit_due_cents + order.balance_due_cents)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleApproveChanges}
                    disabled={submitting}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    {submitting ? 'Processing...' : '✓ Approve Changes'}
                  </button>
                  <a
                    href="tel:+13138893860"
                    className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors text-center"
                  >
                    📞 Call to Discuss
                  </a>
                </div>
              </div>
            )}

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
