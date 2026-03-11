import { useSearchParams } from 'react-router-dom';
import { usePaymentCompletion } from '../hooks/usePaymentCompletion';
import { PaymentLoadingState } from '../components/payment/PaymentLoadingState';
import { PaymentErrorState } from '../components/payment/PaymentErrorState';
import { PaymentSuccessState } from '../components/payment/PaymentSuccessState';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id');
  const sessionId = searchParams.get('session_id');

  console.log('[PAYMENT-COMPLETE-PAGE] Rendering with orderId:', orderId, 'sessionId:', sessionId);

  const { status, error, orderDetails, isAdminInvoice } = usePaymentCompletion(orderId, sessionId);

  console.log('[PAYMENT-COMPLETE-PAGE] Status:', status, 'Error:', error, 'OrderDetails:', orderDetails);

  if (status === 'loading') {
    console.log('[PAYMENT-COMPLETE-PAGE] Showing loading state');
    return <PaymentLoadingState />;
  }

  if (status === 'error') {
    console.log('[PAYMENT-COMPLETE-PAGE] Showing error state:', error);
    return <PaymentErrorState error={error} />;
  }

  console.log('[PAYMENT-COMPLETE-PAGE] Showing success state');
  return <PaymentSuccessState orderDetails={orderDetails} isAdminInvoice={isAdminInvoice} />;
}
