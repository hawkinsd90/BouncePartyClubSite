import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { calculateDrivingDistance } from '../lib/pricing';
import { HOME_BASE } from '../lib/constants';
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';
import { getOrderById } from '../lib/queries/orders';
import { ORDER_STATUS } from '../lib/constants/statuses';

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

      let orderData: any;

      if (isInvoiceLink && invoiceLink?.link_token) {
        // Single token-validated RPC returns full joined order data without open RLS
        const { data: fullOrderJson, error: rpcError } = await supabase.rpc(
          'get_order_with_relations_by_token',
          { p_token: invoiceLink.link_token }
        );
        if (rpcError || !fullOrderJson) {
          console.error('Error loading order via token:', rpcError);
          setLoading(false);
          return null;
        }
        orderData = fullOrderJson as any;
      } else {
        const { data: orderDataRaw, error } = await getOrderById(orderIdToLoad);
        orderData = orderDataRaw as any;
        if (error || !orderData) {
          console.error('Error loading order:', error);
          setLoading(false);
          return null;
        }
      }

      if (!orderData) {
        setLoading(false);
        return null;
      }

      if (!orderData.travel_total_miles && orderData.travel_fee_cents > 0 && orderData.addresses) {
        const addr = orderData.addresses as any;
        const lat = parseFloat(addr.lat);
        const lng = parseFloat(addr.lng);
        if (lat && lng) {
          calculateDrivingDistance(HOME_BASE.lat, HOME_BASE.lng, lat, lng).then(miles => {
            if (miles > 0) {
              supabase.from('orders').update({ travel_total_miles: miles }).eq('id', orderData.id);
            }
          }).catch(() => {});
        }
      }

      const needsChangelog =
        orderData.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL ||
        orderData.status === ORDER_STATUS.PENDING;

      const [changelogResult, summaryData] = await Promise.all([
        needsChangelog
          ? supabase
              .from('order_changelog')
              .select('*')
              .eq('order_id', orderIdToLoad)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        loadOrderSummary(orderIdToLoad),
      ]);

      if (!summaryData) {
        console.error('Error loading order summary for order:', orderIdToLoad);
      }

      const changelog: any[] = changelogResult.data || [];
      const orderItems: any[] = summaryData?.items || [];
      const discounts: any[] = summaryData?.discounts || [];
      const customFees: any[] = summaryData?.customFees || [];

      if (orderData && orderData.tax_waived) {
        orderData.tax_cents = 0;
      }

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
