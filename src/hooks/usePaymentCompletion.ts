import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import { sendBookingConfirmationNotifications } from '../lib/orderNotificationService';

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
    wet_or_dry: string;
    unit_price_cents: number;
    units: {
      name: string;
    };
  }>;
}

export function usePaymentCompletion(orderId: string | null, sessionId: string | null) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [isAdminInvoice, setIsAdminInvoice] = useState(false);

  useEffect(() => {
    console.log('[PAYMENT-COMPLETE] useEffect triggered with orderId:', orderId, 'sessionId:', sessionId);

    if (!orderId) {
      console.log('[PAYMENT-COMPLETE] No order ID - setting error state');
      setError('No order ID provided');
      setStatus('error');
      return;
    }

    processPayment();
  }, [orderId, sessionId]);

  async function processPayment() {
    try {
      setStatus('loading');
      console.log('[PAYMENT-COMPLETE] Processing payment for order:', orderId);

      // Check if we've already processed this payment (prevent re-processing on refresh)
      const processedKey = `payment_processed_${orderId}`;
      const alreadyProcessed = SafeStorage.getItem(processedKey);

      if (alreadyProcessed) {
        console.log('[PAYMENT-COMPLETE] Payment already processed, skipping notifications');
      }

      // Wait for webhook to process and retry a few times if order status hasn't updated
      let order = null;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retries === 0 ? 2000 : 1000));

        order = await fetchOrderDetails();

        if (order) {
          console.log('[PAYMENT-COMPLETE] Retry', retries, '- Order status:', order.status, 'tip_cents:', order.tip_cents);

          // Check if webhook has processed (status changed from draft and tip_cents is set)
          if (order.status !== 'draft' || order.tip_cents > 0) {
            console.log('[PAYMENT-COMPLETE] Webhook has processed the payment');
            break;
          }
        }

        retries++;
        if (retries < maxRetries) {
          console.log('[PAYMENT-COMPLETE] Webhook may not have processed yet, retrying...');
        }
      }

      console.log('[PAYMENT-COMPLETE] Order fetch result:', order ? 'SUCCESS' : 'NULL');

      if (order) {
        console.log('[PAYMENT-COMPLETE] Final order details:', {
          id: order.id,
          status: order.status,
          tip_cents: order.tip_cents,
          deposit_due_cents: order.deposit_due_cents,
          customer_selected_payment_cents: order.customer_selected_payment_cents,
        });

        // If webhook still hasn't processed, manually verify and update via edge function
        if (order.status === 'draft' && order.tip_cents === 0 && sessionId) {
          console.log('[PAYMENT-COMPLETE] Webhook failed to process, calling verify-payment...');
          try {
            const verifyResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-payment`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId, orderId }),
              }
            );

            const verifyResult = await verifyResponse.json();
            console.log('[PAYMENT-COMPLETE] Verify payment result:', verifyResult);

            if (verifyResult.success) {
              // Refetch order with updated data
              order = await fetchOrderDetails();
              console.log('[PAYMENT-COMPLETE] Order refetched after manual verification:', order);
            }
          } catch (verifyError) {
            console.error('[PAYMENT-COMPLETE] Error verifying payment:', verifyError);
          }
        }

        setOrderDetails(order);
        await checkIfAdminInvoice();

        // Only send notifications if we haven't processed this payment before
        if (!alreadyProcessed) {
          await sendNotificationsIfNeeded(order);
          SafeStorage.setItem(processedKey, 'true');
        }
      } else {
        console.error('[PAYMENT-COMPLETE] Order is null, setting error state');
        setError('Unable to load order details');
      }

      clearLocalStorage();
      setStatus('success');
    } catch (err: any) {
      console.error('[PAYMENT-COMPLETE] Error:', err);
      setError(err.message);
      setStatus('error');
    }
  }

  async function fetchOrderDetails(): Promise<OrderDetails | null> {
    console.log('[PAYMENT-COMPLETE] Fetching order details for:', orderId);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        `
        *,
        customer:customers!customer_id (
          first_name,
          last_name,
          email,
          phone
        ),
        addresses (
          line1,
          city,
          state,
          zip
        ),
        order_items (
          qty,
          wet_or_dry,
          unit_price_cents,
          units (
            name
          )
        )
      `
      )
      .eq('id', orderId!)
      .maybeSingle();

    if (orderError) {
      console.error('[PAYMENT-COMPLETE] Error fetching order:', orderError);
      return null;
    }

    if (!order) {
      console.error('[PAYMENT-COMPLETE] No order found with ID:', orderId);
      return null;
    }

    console.log('[PAYMENT-COMPLETE] Order fetched successfully:', order);
    return order as unknown as OrderDetails;
  }

  async function checkIfAdminInvoice() {
    const { data: invoiceLink } = await supabase
      .from('invoice_links' as any)
      .select('id')
      .eq('order_id', orderId!)
      .maybeSingle();

    setIsAdminInvoice(!!invoiceLink);
  }

  async function sendNotificationsIfNeeded(order: OrderDetails) {
    const { data: orderCheck } = await supabase
      .from('orders')
      .select('booking_confirmation_sent')
      .eq('id', orderId!)
      .maybeSingle();

    if (orderCheck?.booking_confirmation_sent) {
      console.log('[PAYMENT-COMPLETE] Notifications already sent for this order. Skipping.');
      return;
    }

    await sendBookingConfirmationNotifications(order);

    await supabase
      .from('orders')
      .update({ booking_confirmation_sent: true })
      .eq('id', orderId!);
  }

  function clearLocalStorage() {
    console.log('[PAYMENT-COMPLETE] Clearing localStorage data...');
    SafeStorage.removeItem('bpc_cart');
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
  };
}
