import { formatOrderId } from '../../lib/utils';
import { format } from 'date-fns';

interface AdminFloatingOrderHeaderProps {
  order: {
    id: string;
    status: string;
    event_date: string;
    customers?: {
      first_name: string;
      last_name: string;
      business_name?: string;
    };
    addresses?: {
      city: string;
      state: string;
    };
  } | null;
  isVisible: boolean;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending_review: { label: 'PENDING REVIEW', className: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  awaiting_customer_approval: { label: 'AWAITING APPROVAL', className: 'bg-blue-100 text-blue-800 border-blue-300' },
  confirmed: { label: 'CONFIRMED', className: 'bg-green-100 text-green-800 border-green-300' },
  cancelled: { label: 'CANCELLED', className: 'bg-red-100 text-red-800 border-red-300' },
  completed: { label: 'COMPLETED', className: 'bg-slate-100 text-slate-800 border-slate-300' },
  draft: { label: 'DRAFT', className: 'bg-slate-100 text-slate-600 border-slate-300' },
};

export function AdminFloatingOrderHeader({ order, isVisible }: AdminFloatingOrderHeaderProps) {
  if (!isVisible || !order) {
    return null;
  }

  const statusBadge = STATUS_BADGES[order.status] || STATUS_BADGES.draft;
  const customerName = order.customers?.business_name ||
    `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
  const eventLocation = order.addresses ? `${order.addresses.city}, ${order.addresses.state}` : '';
  const eventDate = format(new Date(order.event_date), 'EEE, MMM d, yyyy');

  return (
    <div className="fixed top-0 left-0 right-0 bg-gradient-to-b from-blue-50 to-blue-100 border-b-4 border-blue-400 shadow-lg z-50 animate-slide-down">
      <div className="max-w-7xl mx-auto px-3 py-2 md:px-6 md:py-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 text-sm md:text-base truncate">
                {customerName}
              </h3>
              <span className="text-xs md:text-sm text-slate-600 font-mono">
                #{formatOrderId(order.id)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs md:text-sm text-slate-600 flex-wrap">
              <span>{eventDate}</span>
              {eventLocation && (
                <>
                  <span>•</span>
                  <span>{eventLocation}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex-shrink-0">
            <span
              className={`inline-flex items-center px-2 py-1 md:px-3 md:py-1 rounded-full text-xs font-medium border ${statusBadge.className}`}
            >
              {statusBadge.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
