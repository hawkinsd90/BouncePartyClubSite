import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePaymentCompletion } from '../hooks/usePaymentCompletion';
import { PaymentLoadingState } from '../components/payment/PaymentLoadingState';
import { PaymentErrorState } from '../components/payment/PaymentErrorState';
import { PaymentSuccessState } from '../components/payment/PaymentSuccessState';
import { trackEvent } from '../lib/siteEvents';

export function PaymentComplete() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id');
  const sessionId = searchParams.get('session_id');

  // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
  // Restore only after a true dev/staging environment and explicit safe gating are in place.
  // Previously logged Stripe Checkout Session ID (cs_xxx) and full orderDetails object (financial + PII).
  // console.log('[PAYMENT-COMPLETE-PAGE] Rendering with orderId:', orderId, 'sessionId:', sessionId);

  const { status, error, orderDetails, isAdminInvoice, sessionTipCents } = usePaymentCompletion(orderId, sessionId);

  useEffect(() => {
    if (status === 'success' && orderId) {
      trackEvent('checkout_completed', { orderId });
    }
  }, [status, orderId]);

  // BPC-SECURITY-HARDENING: COMMENTED OUT FOR PRODUCTION.
  // Restore only after a true dev/staging environment and explicit safe gating are in place.
  // Previously logged full orderDetails object including financial fields and customer data.
  // console.log('[PAYMENT-COMPLETE-PAGE] Status:', status, 'Error:', error, 'OrderDetails:', orderDetails);

  if (status === 'loading') {
    console.log('[PAYMENT-COMPLETE-PAGE] Showing loading state');
    return <PaymentLoadingState />;
  }

  if (status === 'error') {
    console.log('[PAYMENT-COMPLETE-PAGE] Showing error state:', error);
    return <PaymentErrorState error={error} />;
  }

  console.log('[PAYMENT-COMPLETE-PAGE] Showing success state');
  return <PaymentSuccessState orderDetails={orderDetails} isAdminInvoice={isAdminInvoice} sessionTipCents={sessionTipCents} />;
}
