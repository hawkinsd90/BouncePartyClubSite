import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Order } from '../types/orders';
import { ORDER_STATUS } from '../lib/constants/statuses';

export function useOrders(userId: string | undefined) {
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const isLoadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const currentUserIdRef = useRef<string | undefined>(undefined);

  const loadOrders = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    if (isLoadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isLoadingRef.current = true;
    pendingRefreshRef.current = false;
    const loadingForUserId = userId;
    currentUserIdRef.current = userId;
    setLoading(true);
    try {
      // The orders table is not readable by customers. get_my_orders() derives the caller's identity from their session
      // on the server (no customer id, email or contact id is sent) and returns only the customer-facing fields of their
      // own orders, with items, discounts, fees, address and payment history already attached.
      const { data: ordersRows, error } = await supabase.rpc('get_my_orders');

      if (error) {
        console.error('Error loading orders:', error);
        return;
      }

      const ordersData = ((ordersRows as unknown) as Order[] | null) ?? [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const upcoming: Order[] = [];
      const active: Order[] = [];
      const past: Order[] = [];

      ordersData.forEach((order) => {
        const eventDate = new Date(order.event_date + 'T12:00:00');
        const eventEndDate = order.event_end_date ? new Date(order.event_end_date + 'T12:00:00') : eventDate;

        if (
          (eventDate <= today && eventEndDate >= today) ||
          order.status === ORDER_STATUS.IN_PROGRESS
        ) {
          active.push(order);
        } else if (eventDate > today && !([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID] as string[]).includes(order.status)) {
          upcoming.push(order);
        } else {
          past.push(order);
        }
      });

      upcoming.sort((a, b) => new Date(a.event_date + 'T12:00:00').getTime() - new Date(b.event_date + 'T12:00:00').getTime());
      active.sort((a, b) => new Date(a.event_date + 'T12:00:00').getTime() - new Date(b.event_date + 'T12:00:00').getTime());
      past.sort((a, b) => new Date(b.event_date + 'T12:00:00').getTime() - new Date(a.event_date + 'T12:00:00').getTime());

      if (currentUserIdRef.current === loadingForUserId) {
        setUpcomingOrders(upcoming);
        setActiveOrders(active);
        setPastOrders(past);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      if (currentUserIdRef.current === loadingForUserId) {
        setLoading(false);
      }
      isLoadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        loadOrders();
      }
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      loadOrders();
    }
  }, [userId, loadOrders]);

  return {
    upcomingOrders,
    activeOrders,
    pastOrders,
    loading,
    reloadOrders: loadOrders,
  };
}
