import { useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { OrderSummary } from '../order/OrderSummary';
import { OrderSummaryDisplay } from '../../lib/orderSummary';
import { ApprovalModal } from './ApprovalModal';
import { RejectionModal } from './RejectionModal';

interface OrderApprovalViewProps {
  order: any;
  changelog: any[];
  orderSummary: OrderSummaryDisplay | null;
  onApprovalSuccess: () => void;
  onRejectionSuccess: () => void;
}

export function OrderApprovalView({
  order,
  changelog,
  orderSummary,
  onApprovalSuccess,
  onRejectionSuccess,
}: OrderApprovalViewProps) {
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

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
    return val;
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      event_date: 'Event Date',
      event_end_date: 'Event End Date',
      address: 'Address',
      location_type: 'Location Type',
      surface: 'Surface',
      generator_qty: 'Generators',
      pickup_preference: 'Pickup',
      total: 'Total Price',
      order_items: 'Equipment',
    };
    return labels[field] || field;
  };

  const customerRelevantFields = [
    'event_date',
    'event_end_date',
    'address',
    'location_type',
    'surface',
    'generator_qty',
    'pickup_preference',
    'total',
    'order_items',
  ];

  const relevantChanges = changelog.filter((c) =>
    customerRelevantFields.includes(c.field_changed)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 py-4 md:py-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg md:rounded-xl shadow-2xl overflow-hidden border-2 md:border-4 border-amber-400">
          <div className="bg-white px-4 md:px-8 py-4 md:py-6 text-center border-b-2 md:border-b-4 border-amber-400">
            <img
              src="/bounce party club logo.png"
              alt="Bounce Party Club"
              className="h-16 md:h-20 w-auto mx-auto mb-3 md:mb-4"
            />
            <h1 className="text-lg md:text-2xl font-bold text-amber-900">
              Order Changes - Approval Required
            </h1>
            <p className="text-sm md:text-base text-amber-700 mt-1 md:mt-2">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>

          <div className="px-4 md:px-8 py-4 md:py-8">
            <div className="bg-amber-100 border-2 border-amber-500 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
              <h2 className="text-base md:text-lg font-bold text-amber-900 mb-2 md:mb-3">
                Action Required
              </h2>
              <p className="text-sm md:text-base text-amber-800">
                We've updated your booking details. Please review the changes below and confirm
                your approval.
              </p>
            </div>

            {order.admin_message && (
              <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
                <h3 className="font-bold text-blue-900 mb-2 md:mb-3 text-base md:text-lg">
                  Message from Bounce Party Club
                </h3>
                <p className="text-sm md:text-base text-blue-800 whitespace-pre-wrap">
                  {order.admin_message}
                </p>
              </div>
            )}

            {!order.stripe_payment_method_id &&
              changelog.some((c) => c.field_changed === 'payment_method') && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 md:p-6 mb-4 md:mb-6">
                  <h3 className="font-bold text-amber-900 mb-2 md:mb-3 text-base md:text-lg">
                    Payment Update Required
                  </h3>
                  <p className="text-sm md:text-base text-amber-800">
                    Due to changes in your order, your previous payment method has been removed
                    for your security. You'll need to provide a new payment method when you
                    approve these changes.
                  </p>
                </div>
              )}

            {relevantChanges.length > 0 && (
              <div className="bg-orange-50 border-2 border-orange-400 rounded-lg p-3 md:p-5 mb-4 md:mb-6">
                <h3 className="font-bold text-orange-900 mb-2 md:mb-3 text-sm md:text-base flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 md:w-5 md:h-5" />
                  What Changed
                </h3>
                <div className="bg-white rounded border border-orange-200 divide-y divide-orange-100">
                  {relevantChanges
                    .filter((change) => {
                      if (change.field_changed === 'event_end_date') {
                        const eventDateChange = relevantChanges.find(
                          (c) => c.field_changed === 'event_date'
                        );
                        if (
                          eventDateChange &&
                          change.new_value === eventDateChange.new_value
                        ) {
                          return false;
                        }
                      }
                      return true;
                    })
                    .sort((a, b) => {
                      const order = [
                        'total',
                        'event_date',
                        'event_end_date',
                        'address',
                        'pickup',
                        'location_type',
                        'surface',
                        'generator_qty',
                        'order_items',
                      ];
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
                              <>
                                {oldVal && (
                                  <span className="text-red-700">Removed: {oldVal}</span>
                                )}
                                {newVal && (
                                  <span className="text-green-700 font-semibold">
                                    Added: {newVal}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-red-700 line-through break-words">
                                  {oldVal}
                                </span>
                                <span className="text-slate-400">→</span>
                                <span className="text-green-700 font-semibold break-words">
                                  {newVal}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="bg-slate-50 rounded-lg p-3 md:p-6 mb-4 md:mb-6 border-2 border-slate-200">
              <h3 className="font-bold text-slate-900 mb-3 md:mb-4 text-base md:text-lg">
                Current Booking Information
              </h3>
              <div className="space-y-2 md:space-y-3">
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Customer:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.customers?.first_name || 'Unknown'}{' '}
                    {order.customers?.last_name || ''}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Event Date:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {format(new Date(order.event_date), 'MMMM d, yyyy')}
                    {order.event_end_date && order.event_end_date !== order.event_date && (
                      <> - {format(new Date(order.event_end_date), 'MMMM d, yyyy')}</>
                    )}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Time:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.start_window} - {order.end_window}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Location Type:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.location_type === 'residential' ? 'Residential' : 'Commercial'}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Address:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.addresses?.line1}, {order.addresses?.city},{' '}
                    {order.addresses?.state} {order.addresses?.zip}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Surface:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.surface === 'grass' ? 'Grass (Stakes)' : 'Sandbags'}
                  </span>
                </div>
                <div className="py-2 border-b border-slate-200">
                  <span className="text-slate-600 font-medium text-sm md:text-base block mb-1">
                    Pickup:
                  </span>
                  <span className="text-slate-900 font-semibold text-sm md:text-base">
                    {order.pickup_preference === 'next_day' ? 'Next Morning' : 'Same Day'}
                  </span>
                </div>

                {orderSummary && (
                  <OrderSummary
                    summary={orderSummary}
                    showDeposit={true}
                    showTip={orderSummary.tip > 0}
                    title="Complete Price Breakdown"
                    changelog={changelog}
                    className="p-3 md:p-4"
                    taxWaived={order.tax_waived || false}
                    travelFeeWaived={order.travel_fee_waived || false}
                    surfaceFeeWaived={order.surface_fee_waived || false}
                    generatorFeeWaived={order.generator_fee_waived || false}
                    sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
                  />
                )}
              </div>
            </div>

            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
              <h3 className="font-bold text-blue-900 mb-2">Identity Verification Required</h3>
              <p className="text-blue-800 text-sm">
                To approve these changes, you'll be asked to confirm your identity by entering
                your full name exactly as it appears on the order:{' '}
                <strong>
                  {order.customers?.first_name || 'Unknown'}{' '}
                  {order.customers?.last_name || ''}
                </strong>
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <button
                  onClick={() => setShowApproveModal(true)}
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
                onClick={() => setShowRejectModal(true)}
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
            onSuccess={onApprovalSuccess}
          />

          <RejectionModal
            isOpen={showRejectModal}
            onClose={() => setShowRejectModal(false)}
            order={order}
            onSuccess={onRejectionSuccess}
          />
        </div>
      </div>
    </div>
  );
}
