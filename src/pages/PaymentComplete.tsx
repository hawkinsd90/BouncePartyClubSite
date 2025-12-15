import { useSearchParams } from 'react-router-dom';
import { usePaymentCompletion } from '../hooks/usePaymentCompletion';
import { PaymentLoadingState } from '../components/payment/PaymentLoadingState';
import { PaymentErrorState } from '../components/payment/PaymentErrorState';
import { PaymentSuccessState } from '../components/payment/PaymentSuccessState';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const sessionId = searchParams.get('session_id');

  const { status, error, orderDetails, isAdminInvoice } = usePaymentCompletion(orderId, sessionId);

  if (status === 'loading') {
    return <PaymentLoadingState />;
  }

  if (status === 'error') {
    return <PaymentErrorState error={error} />;
  }

  return <PaymentSuccessState orderDetails={orderDetails} isAdminInvoice={isAdminInvoice} />;
}
