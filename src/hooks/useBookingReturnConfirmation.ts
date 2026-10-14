import { useState, useEffect } from 'react';
import { loadCompletedBooking } from '../lib/booking/bookingApi';
import { SafeStorage } from '../lib/core/safeStorage';
import { sendCustomerBookingConfirmationNotifications } from '../lib/notifications/orderNotificationService';
import { ORDER_STATUS } from '../lib/constants/statuses';
import { confirmationSettled } from '../lib/booking/confirmationRetry';

interface OrderDetails {
  id: string;
  status: string;
  event_date: string;
  deposit_due_cents: number;
  balance_due_cents: number;
  customer_selected_payment_cents?: number;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  start_window: string;
  end_window: string;
  location_type: string;
  surface: string;
  attendees?: number;
  pets?: boolean;
  special_details?: string;
  travel_total_miles: number | null;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  };
  addresses: {
    line1: string;
    city: string;
    state: string;
    zip: string;
  };
  order_items: Array<{
    qty: number;
    wet_or_dry: string | null;
    unit_price_cents: number;
    unit_id: string | null;
    product_id: string | null;
    bundle_id: string | null;
    item_name: string | null;
    pricing_context: string | null;
    component_snapshot: any | null;
    units: { name: string } | null;
  }>;
}

export function useBookingReturnConfirmation(orderId: string | null, sessionId: string | null) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [isAdminInvoice, setIsAdminInvoice] = useState(false);
  const [sessionTipCents, setSessionTipCents] = useState<number>(0);
  const [shouldRedirectToPortal, setShouldRedirectToPortal] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError('No order ID provided');
      setStatus('error');
      return;
    }
    if (!sessionId) {
      setError('No payment session was provided. Please use the link from your Stripe confirmation.');
      setStatus('error');
      return;
    }

    processPayment();
  }, [orderId, sessionId]);

  async function processPayment() {
    try {
      setStatus('loading');

      const processedKey = `payment_processed_${orderId}`;
      const alreadyProcessed = SafeStorage.getItem(processedKey);

      if (!alreadyProcessed) {
        setIsFirstVisit(true);
      }

      // Everything the page needs now comes from the complete-booking function, which requires proof of the completed
      // Stripe session. The browser no longer reads orders, customers, addresses, order items or invoice links.
      let completed = null;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        completed = await loadCompletedBooking(orderId!, sessionId!);

        if (completed) {
          if (completed.order.status !== ORDER_STATUS.DRAFT) {
            break;
          }
        }

        retries++;
      }

      if (completed) {
        if (completed.order.status === ORDER_STATUS.DRAFT) {
          try {
            const savePaymentMethodResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-payment-method-from-session`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId, orderId }),
              }
            );

            if (savePaymentMethodResponse.ok) {
              await savePaymentMethodResponse.json();
            } else {
              console.error('[PAYMENT-COMPLETE] Failed to save payment method (non-OK response).');
            }
          } catch (err) {
            console.error('[PAYMENT-COMPLETE] Error saving payment method:', err);
          }

          let lifecycleOk = false;
          try {
            const { enterPendingReview, enterConfirmed } = await import('../lib/orders/orderLifecycleApi');
            let lifecycleResult;
            if (completed.isAdminInvoice) {
              lifecycleResult = await enterConfirmed(orderId!, 'webhook_fallback_admin_invoice', 'charged_now', undefined, { sessionId });
            } else {
              lifecycleResult = await enterPendingReview(orderId!, 'webhook_fallback_standard', { sessionId });
            }
            lifecycleOk = lifecycleResult.success === true;
          } catch (lifecycleErr) {
            console.error('[PAYMENT-COMPLETE] Lifecycle call threw unexpectedly:', lifecycleErr);
          }

          if (!lifecycleOk) {
            setError('Your card was saved but we could not complete the booking request. Please contact us to confirm your booking.');
            clearLocalStorage();
            setStatus('error');
            return;
          }

          completed = await loadCompletedBooking(orderId!, sessionId!);
          if (!completed) {
            setError('Unable to load order details');
            setStatus('error');
            return;
          }
        }

        const order = completed.order as OrderDetails & { booking_confirmation_sent?: boolean };
        setOrderDetails(order);
        setSessionTipCents(completed.tipCents);
        const adminInvoice = completed.isAdminInvoice;
        setIsAdminInvoice(adminInvoice);

        if (!alreadyProcessed && !adminInvoice) {
          // Remember this visit as handled only when the confirmation is settled. A failed or still-in-progress send must stay
          // retryable on the next visit; the server decides whether anything is actually sent.
          const settled = await sendNotificationsIfNeeded(order);
          if (settled) SafeStorage.setItem(processedKey, 'true');
        }

        if (adminInvoice) {
          setShouldRedirectToPortal(true);
        }
      } else {
        console.error('[PAYMENT-COMPLETE] Order is null, setting error state');
        setError('Unable to load order details');
        setStatus('error');
        return;
      }

      clearLocalStorage();
      setStatus('success');
    } catch (err: any) {
      console.error('[PAYMENT-COMPLETE] Error:', err);
      setError(err.message);
      setStatus('error');
    }
  }

  async function sendNotificationsIfNeeded(order: OrderDetails & { booking_confirmation_sent?: boolean }): Promise<boolean> {
    if (order.booking_confirmation_sent) {
      setEmailSent(true);
      setEmailError(null);
      return confirmationSettled(true, null);
    }

    const result = await sendCustomerBookingConfirmationNotifications(order, sessionId!);
    setEmailSent(result.emailSent);
    setEmailError(result.emailError || null);
    // complete-booking marks the confirmation sent itself, once the email has actually gone out.
    return confirmationSettled(false, result);
  }

  function clearLocalStorage() {
    SafeStorage.removeItem('bpc_cart');
    window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
    SafeStorage.removeItem('bpc_quote_form');
    SafeStorage.removeItem('bpc_price_breakdown');
    SafeStorage.removeItem('bpc_contact_data');
    SafeStorage.removeItem('test_booking_tip');
  }

  return {
    status,
    error,
    orderDetails,
    isAdminInvoice,
    sessionTipCents,
    shouldRedirectToPortal,
    isFirstVisit,
    emailSent,
    emailError,
  };
}
