import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { calculateDrivingDistance } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';

export interface OrderData {
  order: any;
  changelog: any[];
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: any | null;
  orderSummary: OrderSummaryDisplay | null;
}

export function useOrderData() {
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOrder = useCallback(async (orderId: string | undefined, token: string | undefined, isInvoiceLink: boolean) => {
    setLoading(true);
    try {
      let orderIdToLoad = orderId;
      let invoiceLink = null;

      if (isInvoiceLink && token) {
        const { data: linkData, error: linkError } = await supabase
          .from('invoice_links')
          .select('*')
          .eq('link_token', token)
          .maybeSingle();

        if (linkError || !linkData) {
          setLoading(false);
          return null;
        }

        if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
          setLoading(false);
          return null;
        }

        invoiceLink = linkData;
        orderIdToLoad = linkData.order_id;
      }

      if (!orderIdToLoad) {
        console.error('No order ID provided');
        setLoading(false);
        return null;
      }

      const { data: orderData, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*)
        `)
        .eq('id', orderIdToLoad)
        .single();

      if (error) {
        console.error('Error loading order:', error);
        setLoading(false);
        return null;
      }

      if (!orderData) {
        setLoading(false);
        return null;
      }

      let travelMiles = orderData.travel_total_miles || 0;
      if (travelMiles === 0 && orderData.travel_fee_cents > 0 && orderData.addresses) {
        try {
          const addr = orderData.addresses as any;
          const lat = parseFloat(addr.lat);
          const lng = parseFloat(addr.lng);
          if (lat && lng) {
            travelMiles = await calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng);
            if (travelMiles > 0) {
              supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', orderData.id);
              orderData.travel_total_miles = travelMiles;
            }
          }
        } catch (error) {
          console.error('Error calculating travel distance:', error);
        }
      }

      const changelog: any[] = [];
      if (orderData.status === 'awaiting_customer_approval' || orderData.status === 'pending_review') {
        const { data: changelogData } = await supabase
          .from('order_changelog')
          .select('*')
          .eq('order_id', orderIdToLoad)
          .order('created_at', { ascending: false });

        if (changelogData) {
          changelog.push(...changelogData);
        }
      }

      const { data: itemsData } = await supabase
        .from('order_items')
        .select('*, units(name)')
        .eq('order_id', orderIdToLoad);

      const { data: discountsData } = await supabase
        .from('order_discounts')
        .select('*')
        .eq('order_id', orderIdToLoad);

      const { data: feesData } = await supabase
        .from('order_custom_fees')
        .select('*')
        .eq('order_id', orderIdToLoad);

      const orderItems = itemsData || [];
      const discounts = discountsData || [];
      const customFees = feesData || [];

      if ((discounts.length > 0 || customFees.length > 0) && orderData) {
        const discountTotal = discounts.reduce((sum: number, d: any) => {
          if (d.amount_cents > 0) {
            return sum + d.amount_cents;
          } else if (d.percentage > 0) {
            const taxableBase = orderData.subtotal_cents + (orderData.generator_fee_cents || 0) + orderData.travel_fee_cents + orderData.surface_fee_cents;
            return sum + Math.round(taxableBase * (d.percentage / 100));
          }
          return sum;
        }, 0);

        const customFeesTotal = customFees.reduce((sum: number, f: any) => sum + f.amount_cents, 0);

        const taxableAmount = Math.max(0,
          orderData.subtotal_cents +
          (orderData.generator_fee_cents || 0) +
          orderData.travel_fee_cents +
          orderData.surface_fee_cents +
          customFeesTotal -
          discountTotal
        );
        const recalculatedTax = Math.round(taxableAmount * 0.06);

        const recalculatedTotal =
          orderData.subtotal_cents +
          (orderData.generator_fee_cents || 0) +
          orderData.travel_fee_cents +
          orderData.surface_fee_cents +
          (orderData.same_day_pickup_fee_cents || 0) +
          customFeesTotal +
          recalculatedTax +
          (orderData.tip_cents || 0) -
          discountTotal;

        orderData.tax_cents = recalculatedTax;
        orderData.balance_due_cents = recalculatedTotal - orderData.deposit_due_cents;
      }

      const summaryData = await loadOrderSummary(orderIdToLoad);
      const orderSummary = summaryData ? formatOrderSummary(summaryData) : null;

      const result = {
        order: orderData,
        changelog,
        orderItems,
        discounts,
        customFees,
        invoiceLink,
        orderSummary,
      };

      setData(result);
      setLoading(false);
      return result;
    } catch (error) {
      console.error('Error loading order:', error);
      setLoading(false);
      return null;
    }
  }, []);

  return { data, loading, loadOrder, setData };
}
