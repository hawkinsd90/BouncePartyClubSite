import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePaymentCompletion } from '../hooks/usePaymentCompletion';
import { PaymentLoadingState } from '../components/payment/PaymentLoadingState';
import { PaymentErrorState } from '../components/payment/PaymentErrorState';
import { PaymentSuccessState } from '../components/payment/PaymentSuccessState';
import { trackEvent } from '../lib/siteEvents';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('order_id');
  const sessionId = searchParams.get('session_id');

  const { status, error, orderDetails, isAdminInvoice, sessionTipCents, shouldRedirectToPortal } = usePaymentCompletion(orderId, sessionId);

  useEffect(() => {
    if (status === 'success' && orderId) {
      trackEvent('checkout_completed', { orderId });
    }
  }, [status, orderId]);

  useEffect(() => {
    if (status === 'success' && shouldRedirectToPortal && orderId) {
      navigate(`/customer-portal/${orderId}?invoice_paid=true`, { replace: true });
    }
  }, [status, shouldRedirectToPortal, orderId, navigate]);

  if (status === 'loading' || (status === 'success' && shouldRedirectToPortal)) {
    return <PaymentLoadingState />;
  }

  if (status === 'error') {
    return <PaymentErrorState error={error} />;
  }

  return <PaymentSuccessState orderDetails={orderDetails} isAdminInvoice={isAdminInvoice} sessionTipCents={sessionTipCents} />;
}
