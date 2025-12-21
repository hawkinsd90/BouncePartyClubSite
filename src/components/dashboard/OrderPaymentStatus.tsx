import { Order } from '../../types/orders';
import { ORDER_STATUS, getPaymentStatus, PAYMENT_STATUS } from '../../lib/constants/statuses';

interface OrderPaymentStatusProps {
  order: Order;
}

export function OrderPaymentStatus({ order }: OrderPaymentStatusProps) {
  if (
    order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL ||
    order.status === ORDER_STATUS.DRAFT ||
    order.status === ORDER_STATUS.PENDING
  ) {
    return <span className="text-gray-600 font-medium">Awaiting Order Approval</span>;
  }

  const paymentStatus = getPaymentStatus(order);

  if (paymentStatus === PAYMENT_STATUS.PAID_IN_FULL) {
    return <span className="text-green-600 font-medium">Paid in Full</span>;
  } else if (paymentStatus === PAYMENT_STATUS.DEPOSIT_PAID) {
    return <span className="text-blue-600 font-medium">Deposit Paid</span>;
  }
  return <span className="text-orange-600 font-medium">Payment Due</span>;
}
