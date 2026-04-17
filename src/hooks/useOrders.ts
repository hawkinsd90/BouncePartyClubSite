import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Order } from '../types/orders';
import { ORDER_STATUS } from '../lib/constants/statuses';

export function useOrders(userId: string | undefined, userEmail: string | undefined) {
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const isLoadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const currentUserIdRef = useRef<string | undefined>(undefined);

  const loadOrders = useCallback(async () => {
    if (!userId || !userEmail) {
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
      const [profileResult, emailResult] = await Promise.all([
        supabase
          .from('customer_profiles')
          .select(`
            contact_id,
            contacts (
              customer_id
            )
          `)
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('customers')
          .select('id')
          .eq('email', userEmail),
      ]);

      const profileData = profileResult.data;
      const emailCustomers = emailResult.data;

      if (profileResult.error) {
        console.error('Error loading customer profile:', profileResult.error);
      }
      if (emailResult.error) {
        console.error('Error loading customers by email:', emailResult.error);
      }

      let customerIds: string[] = [];

      const profileAny = profileData as any;
      if (profileAny?.contacts?.customer_id) {
        customerIds.push(profileAny.contacts.customer_id);
      }

      if (emailCustomers) {
        customerIds.push(...emailCustomers.map(c => c.id));
      }

      customerIds = Array.from(new Set(customerIds));

      if (customerIds.length === 0) {
        return;
      }

      const { data: ordersData, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*),
          payments (*),
          order_items (
            *,
            units (
              name
            )
          )
        `)
        .in('customer_id', customerIds)
        .order('event_date', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error loading orders:', error);
        return;
      }

      if (ordersData) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcoming: Order[] = [];
        const active: Order[] = [];
        const past: Order[] = [];

        ordersData.forEach((order: any) => {
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
  }, [userId, userEmail]);

  useEffect(() => {
    if (userId && userEmail) {
      loadOrders();
    }
  }, [userId, userEmail, loadOrders]);

  return {
    upcomingOrders,
    activeOrders,
    pastOrders,
    loading,
    reloadOrders: loadOrders,
  };
}
