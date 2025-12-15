import { Order } from '../../types/orders';

interface OrderPaymentStatusProps {
  order: Order;
}

export function OrderPaymentStatus({ order }: OrderPaymentStatusProps) {
  if (order.status === 'awaiting_customer_approval' || order.status === 'draft' || order.status === 'pending') {
    return <span className="text-gray-600 font-medium">Awaiting Order Approval</span>;
  }

  const totalPaid = order.deposit_paid_cents + order.balance_paid_cents;
  const totalDue = order.deposit_due_cents + order.balance_due_cents;

  if (totalPaid >= totalDue) {
    return <span className="text-green-600 font-medium">Paid in Full</span>;
  } else if (order.deposit_paid_cents > 0) {
    return <span className="text-blue-600 font-medium">Deposit Paid</span>;
  } else {
    return <span className="text-orange-600 font-medium">Payment Due</span>;
  }
}
