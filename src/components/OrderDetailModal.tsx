import { X } from 'lucide-react';

interface OrderDetailModalProps {
  order: any;
  onClose: () => void;
  onUpdate: () => void;
}

export function OrderDetailModal({ order, onClose, onUpdate }: OrderDetailModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">
            Order #{order.id.slice(0, 8).toUpperCase()}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Customer Information</h3>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-slate-900">
                <span className="font-medium">Name:</span> {order.customers?.first_name} {order.customers?.last_name}
              </p>
              <p className="text-slate-900">
                <span className="font-medium">Email:</span> {order.customers?.email}
              </p>
              <p className="text-slate-900">
                <span className="font-medium">Phone:</span> {order.customers?.phone}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Event Details</h3>
            <div className="bg-slate-50 rounded-lg p-4">
              <p className="text-slate-900">
                <span className="font-medium">Date:</span> {order.event_date}
              </p>
              <p className="text-slate-900">
                <span className="font-medium">Time:</span> {order.start_window} - {order.end_window}
              </p>
              <p className="text-slate-900">
                <span className="font-medium">Location:</span> {order.addresses?.line1}, {order.addresses?.city}, {order.addresses?.state} {order.addresses?.zip}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Status</h3>
            <div className="flex gap-4">
              <div className="bg-slate-50 rounded-lg p-4 flex-1">
                <p className="text-sm text-slate-600 mb-1">Order Status</p>
                <p className="text-lg font-semibold text-slate-900 capitalize">
                  {order.status.replace('_', ' ')}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 flex-1">
                <p className="text-sm text-slate-600 mb-1">Workflow Status</p>
                <p className="text-lg font-semibold text-slate-900 capitalize">
                  {order.workflow_status?.replace(/_/g, ' ') || 'Pending'}
                </p>
              </div>
            </div>
          </div>

          <div className="text-center py-8 text-slate-500">
            <p>Full order workflow features coming soon...</p>
            <p className="text-sm mt-2">This will include workflow buttons, notes, refunds, and more.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
