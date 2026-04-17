import { CheckCircle, Clock, AlertCircle, FileText, X, Truck } from 'lucide-react';
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
  [ORDER_STATUS.CONFIRMED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.CONFIRMED], className: 'bg-green-100 text-green-700', icon: CheckCircle },
  [ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL], className: 'bg-orange-100 text-orange-700', icon: AlertCircle },
  [ORDER_STATUS.IN_PROGRESS]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.IN_PROGRESS], className: 'bg-blue-100 text-blue-700', icon: Clock },
  [ORDER_STATUS.COMPLETED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.COMPLETED], className: 'bg-green-100 text-green-700', icon: CheckCircle },
  [ORDER_STATUS.CANCELLED]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.CANCELLED], className: 'bg-red-100 text-red-700', icon: X },
  [ORDER_STATUS.VOID]: { label: ORDER_STATUS_LABELS[ORDER_STATUS.VOID], className: 'bg-gray-100 text-gray-500', icon: X },
};

interface OrderStatusBadgeProps {
  order: Order;
}

const workflowOverrides: Partial<Record<string, StatusConfig>> = {
  on_the_way: { label: 'On The Way', className: 'bg-blue-100 text-blue-700', icon: Clock },
  arrived: { label: 'Crew Arrived', className: 'bg-yellow-100 text-yellow-700', icon: Clock },
  setup_completed: { label: 'Delivered', className: 'bg-teal-100 text-teal-700', icon: Truck },
  pickup_in_progress: { label: 'Pickup In Progress', className: 'bg-orange-100 text-orange-700', icon: Clock },
};

export function OrderStatusBadge({ order }: OrderStatusBadgeProps) {
  const workflowOverride = order.status === ORDER_STATUS.IN_PROGRESS && order.workflow_status
    ? workflowOverrides[order.workflow_status]
    : undefined;
  const config = workflowOverride || statusConfigs[order.status as OrderStatus] || { label: order.status, className: 'bg-gray-100 text-gray-700', icon: Clock };
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
