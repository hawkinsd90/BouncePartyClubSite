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
  const [sessionTipCents, setSessionTipCents] = useState<number>(0);

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

      // Retrieve tip from Stripe session if available (for display purposes only - tip already saved to order)
      if (sessionId) {
        try {
          const sessionResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-session-metadata`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ sessionId }),
            }
          );

          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            const tipCents = parseInt(sessionData.metadata?.tip_cents || '0', 10);
            setSessionTipCents(tipCents);
            console.log('[PAYMENT-COMPLETE] Retrieved tip from session:', tipCents);
          }
        } catch (err) {
          console.error('[PAYMENT-COMPLETE] Error retrieving session metadata:', err);
        }
      }

      // Check if we've already processed this payment (prevent re-processing on refresh)
      const processedKey = `payment_processed_${orderId}`;
      const alreadyProcessed = SafeStorage.getItem(processedKey);

      if (alreadyProcessed) {
        console.log('[PAYMENT-COMPLETE] Payment already processed, skipping notifications');
      }

      // Check immediately first, then retry with delays if needed
      let order = null;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        // Only wait on retries (not on first attempt)
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        order = await fetchOrderDetails();

        if (order) {
          console.log('[PAYMENT-COMPLETE] Attempt', retries + 1, '- Order status:', order.status, 'tip_cents:', order.tip_cents);

          // Check if webhook has processed (status changed from draft)
          if (order.status !== 'draft') {
            console.log('[PAYMENT-COMPLETE] Webhook has processed - order status:', order.status);
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

        // If webhook still hasn't processed after retries, manually update the order
        if (order.status === 'draft' && sessionId) {
          console.log('[PAYMENT-COMPLETE] Webhook failed to process, manually updating order status...');

          // Check if this is an admin invoice
          const { data: invoiceLink } = await supabase
            .from('invoice_links' as any)
            .select('id')
            .eq('order_id', orderId!)
            .maybeSingle();

          const isAdminInvoice = !!invoiceLink;
          const newStatus = isAdminInvoice ? 'confirmed' : 'pending_review';

          // Update order status (no charge yet, just card saved)
          // Note: tip_cents is already saved when order was created, no need to update it here
          const { error: updateError } = await supabase
            .from('orders')
            .update({
              status: newStatus,
            })
            .eq('id', orderId!);

          if (updateError) {
            console.error('[PAYMENT-COMPLETE] Error manually updating order:', updateError);
          } else {
            console.log(`[PAYMENT-COMPLETE] Successfully updated order to status: ${newStatus}`);
            // Refetch order with updated data
            order = await fetchOrderDetails();
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
    sessionTipCents,
  };
}
