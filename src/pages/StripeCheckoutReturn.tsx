import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useBookingReturnConfirmation } from '../hooks/useBookingReturnConfirmation';
import { ConfirmingBookingState } from '../components/booking-return/ConfirmingBookingState';
import { BookingConfirmationErrorState } from '../components/booking-return/BookingConfirmationErrorState';
import { BookingRequestReceivedView } from '../components/booking-return/BookingRequestReceivedView';
import { trackEvent } from '../lib/siteEvents';
import { portalPathForCurrentVisitor } from '../lib/portal/portalToken';

export function StripeCheckoutReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('order_id');
  const sessionId = searchParams.get('session_id');

  const { status, error, orderDetails, isAdminInvoice, sessionTipCents, shouldRedirectToPortal, isFirstVisit, emailSent, emailError } = useBookingReturnConfirmation(orderId, sessionId);

  useEffect(() => {
    if (status === 'success' && orderId && isFirstVisit) {
      trackEvent('checkout_completed', { orderId });
    }
  }, [status, orderId, isFirstVisit]);

  useEffect(() => {
    if (status === 'success' && shouldRedirectToPortal && orderId) {
      navigate(portalPathForCurrentVisitor(orderId, { invoice_paid: true }), { replace: true });
    }
  }, [status, shouldRedirectToPortal, orderId, navigate]);

  if (status === 'loading' || (status === 'success' && shouldRedirectToPortal)) {
    return <ConfirmingBookingState />;
  }

  if (status === 'error') {
    return <BookingConfirmationErrorState error={error} />;
  }

  return <BookingRequestReceivedView orderDetails={orderDetails} sessionTipCents={sessionTipCents} emailSent={emailSent} emailError={emailError} />;
}
