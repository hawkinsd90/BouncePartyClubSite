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
    if (!orderId) {
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

      await updateOrderViaWebhook();

      const order = await fetchOrderDetails();
      if (order) {
        setOrderDetails(order);
        await checkIfAdminInvoice();
        await sendNotificationsIfNeeded(order);
      }

      clearLocalStorage();
      setStatus('success');
    } catch (err: any) {
      console.error('[PAYMENT-COMPLETE] Error:', err);
      setError(err.message);
      setStatus('error');
    }
  }

  async function updateOrderViaWebhook() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(
      `${supabaseUrl}/functions/v1/stripe-checkout?action=webhook&orderId=${orderId}&session_id=${encodeURIComponent(sessionId ?? '')}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PAYMENT-COMPLETE] Edge function error:', errorText);
      throw new Error('Failed to update order');
    }

    const result = await response.json();
    console.log('[PAYMENT-COMPLETE] Edge function response:', result);
  }

  async function fetchOrderDetails(): Promise<OrderDetails | null> {
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
      .single();

    if (orderError) {
      console.error('[PAYMENT-COMPLETE] Error fetching order:', orderError);
      return null;
    }

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
