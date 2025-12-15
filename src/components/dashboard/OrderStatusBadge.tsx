import { CheckCircle, Clock, AlertCircle, FileText, X } from 'lucide-react';
import { Order } from '../../types/orders';

interface StatusConfig {
  label: string;
  className: string;
  icon: any;
}

const statusConfigs: Record<string, StatusConfig> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700', icon: FileText },
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700', icon: Clock },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  awaiting_customer_approval: { label: 'Awaiting Approval', className: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700', icon: CheckCircle },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700', icon: X },
  voided: { label: 'Voided', className: 'bg-gray-100 text-gray-500', icon: X },
};

interface OrderStatusBadgeProps {
  order: Order;
}

export function OrderStatusBadge({ order }: OrderStatusBadgeProps) {
  const config = statusConfigs[order.status] || statusConfigs.pending;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
