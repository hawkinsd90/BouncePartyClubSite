import { CheckCircle, Clock, AlertCircle, FileText, X } from 'lucide-react';
import { Order } from '../../types/orders';
import { ORDER_STATUS, ORDER_STATUS_LABELS, OrderStatus } from '../../lib/constants/statuses';

interface StatusConfig {
  label: string;
  className: string;
  icon: any;
}

const statusConfigs: Record<OrderStatus, StatusConfig> = {
  [ORDER_STATUS.DRAFT]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.DRAFT], className: 'bg-gray-100 text-gray-700', icon: FileText },
  [ORDER_STATUS.PENDING]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.PENDING], className: 'bg-yellow-100 text-yellow-700', icon: Clock },
  [ORDER_STATUS.CONFIRMED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.CONFIRMED], className: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  [ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL], className: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  [ORDER_STATUS.SETUP_IN_PROGRESS]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.SETUP_IN_PROGRESS], className: 'bg-cyan-100 text-cyan-700', icon: Clock },
  [ORDER_STATUS.ON_THE_WAY]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.ON_THE_WAY], className: 'bg-blue-100 text-blue-700', icon: Clock },
  [ORDER_STATUS.SETUP_COMPLETED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.SETUP_COMPLETED], className: 'bg-teal-100 text-teal-700', icon: CheckCircle },
  [ORDER_STATUS.PICKUP_IN_PROGRESS]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.PICKUP_IN_PROGRESS], className: 'bg-cyan-100 text-cyan-700', icon: Clock },
  [ORDER_STATUS.ON_THE_WAY_BACK]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.ON_THE_WAY_BACK], className: 'bg-blue-100 text-blue-700', icon: Clock },
  [ORDER_STATUS.COMPLETED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.COMPLETED], className: 'bg-green-100 text-green-700', icon: CheckCircle },
  [ORDER_STATUS.CANCELLED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.CANCELLED], className: 'bg-red-100 text-red-700', icon: X },
  [ORDER_STATUS.VOID]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.VOID], className: 'bg-gray-100 text-gray-500', icon: X },
};

interface OrderStatusBadgeProps {
  order: Order;
}

export function OrderStatusBadge({ order }: OrderStatusBadgeProps) {
  const config = statusConfigs[order.status as OrderStatus] || statusConfigs[ORDER_STATUS.PENDING];
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
