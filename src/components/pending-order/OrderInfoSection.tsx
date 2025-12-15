import { format } from 'date-fns';
import { Edit2 } from 'lucide-react';

interface OrderInfoSectionProps {
  order: any;
  customerDisplayName: string;
  onEditClick: () => void;
}

export function OrderInfoSection({ order, customerDisplayName, onEditClick }: OrderInfoSectionProps) {
  const isDraft = order.status === 'draft';
  const isAwaitingApproval = order.status === 'awaiting_customer_approval';

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base md:text-lg font-semibold text-slate-900 truncate">
            {customerDisplayName}
          </h3>
          <p className="text-xs md:text-sm text-slate-600 truncate">{order.customers?.email}</p>
          <p className="text-xs md:text-sm text-slate-600">{order.customers?.phone}</p>
        </div>
        <div className="sm:text-right w-full sm:w-auto shrink-0">
          <div className="flex items-center justify-between sm:justify-end gap-2 mb-2">
            <span
              className={`sm:hidden inline-block px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${isDraft ? 'bg-orange-600' : isAwaitingApproval ? 'bg-amber-600' : 'bg-orange-600'} text-white`}
            >
              {isDraft ? 'DRAFT' : isAwaitingApproval ? 'AWAITING' : 'PENDING'}
            </span>
            <button
              onClick={onEditClick}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Edit2 className="w-3 h-3" />
              <span className="hidden sm:inline">Edit Order</span>
              <span className="sm:hidden">Edit</span>
            </button>
          </div>
          <p className="text-xs md:text-sm text-slate-600">Order ID</p>
          <p className="font-mono text-xs md:text-sm font-semibold">
            {order.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {format(new Date(order.created_at), 'MMM d, yyyy h:mm a')}
          </p>
          <div className="mt-2 hidden sm:block">
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-semibold text-white ${isDraft ? 'bg-orange-600' : isAwaitingApproval ? 'bg-amber-600' : 'bg-orange-600'}`}
            >
              {isDraft
                ? 'DRAFT - NEEDS DEPOSIT'
                : isAwaitingApproval
                  ? 'AWAITING CUSTOMER APPROVAL'
                  : 'PENDING REVIEW'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 p-4 bg-white rounded-lg">
        <div>
          <h4 className="text-sm font-medium text-slate-500 mb-1">Event Date & Time</h4>
          <p className="text-base text-slate-900 font-medium">
            {format(new Date(order.event_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
          </p>
          <p className="text-sm text-slate-600">
            {order.start_window} - {order.end_window}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium text-slate-500 mb-1">Event Location</h4>
          <p className="text-base text-slate-900">
            {order.addresses?.line1}
            {order.addresses?.line2 && `, ${order.addresses.line2}`}
          </p>
          <p className="text-sm text-slate-600">
            {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}
          </p>
          <p className="text-sm text-slate-600 capitalize">
            {order.location_type} + {order.surface || 'Not Specified'}
          </p>
        </div>
      </div>

      <div className="mb-4 p-3 bg-white rounded-lg border border-slate-200">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Generator</div>
            <div className="font-medium text-slate-900">
              {order.generator_required ? 'Yes' : 'No'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Surface</div>
            <div className="font-medium text-slate-900 capitalize">
              {order.surface || 'Not Needed'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pickup</div>
            <div className="font-medium text-slate-900">
              {order.same_day_pickup_fee_cents > 0 ? 'Same Day' : 'Not Specified'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-1">Pets</div>
            <div className="font-medium text-slate-900">{order.has_pets ? 'Yes' : 'No'}</div>
          </div>
        </div>
        {order.special_details && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <span className="text-slate-600 text-sm">Special Details:</span>
            <p className="mt-1 text-sm text-slate-900">{order.special_details}</p>
          </div>
        )}
      </div>
    </>
  );
}
