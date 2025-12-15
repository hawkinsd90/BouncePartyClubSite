import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Order } from '../types/orders';

export function useOrders(userId: string | undefined, userEmail: string | undefined) {
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadOrders() {
    if (!userId || !userEmail) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: profileData } = await supabase
        .from('customer_profiles')
        .select('contact_id')
        .eq('user_id', userId)
        .maybeSingle();

      let customerIds: string[] = [];

      if (profileData?.contact_id) {
        const { data: contactData } = await supabase
          .from('contacts')
          .select('customer_id')
          .eq('id', profileData.contact_id)
          .maybeSingle();

        if (contactData?.customer_id) {
          customerIds.push(contactData.customer_id);
        }
      }

      const { data: emailCustomers } = await supabase
        .from('customers')
        .select('id')
        .eq('email', userEmail);

      if (emailCustomers) {
        customerIds.push(...emailCustomers.map(c => c.id));
      }

      customerIds = Array.from(new Set(customerIds));

      if (customerIds.length === 0) {
        setLoading(false);
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
        .order('event_date', { ascending: false });

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
          const eventDate = new Date(order.event_date);
          const eventEndDate = order.event_end_date ? new Date(order.event_end_date) : eventDate;

          if (
            (eventDate <= today && eventEndDate >= today) ||
            ['en_route_delivery', 'delivered', 'en_route_pickup'].includes(order.workflow_status)
          ) {
            active.push(order);
          } else if (eventDate > today && !['completed', 'cancelled', 'voided'].includes(order.status)) {
            upcoming.push(order);
          } else {
            past.push(order);
          }
        });

        upcoming.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        active.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        past.sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

        setUpcomingOrders(upcoming);
        setActiveOrders(active);
        setPastOrders(past);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (userId && userEmail) {
      loadOrders();
    }
  }, [userId, userEmail]);

  return {
    upcomingOrders,
    activeOrders,
    pastOrders,
    loading,
    reloadOrders: loadOrders,
  };
}
